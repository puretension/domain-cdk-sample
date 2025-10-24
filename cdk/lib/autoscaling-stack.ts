import * as cdk from "aws-cdk-lib";
import * as applicationautoscaling from "aws-cdk-lib/aws-applicationautoscaling";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as ecs from "aws-cdk-lib/aws-ecs";
import { Construct } from "constructs";

export interface AutoScalingStackProps extends cdk.StackProps {
  ecsService: ecs.FargateService;
  alarms: {
    highCpuAlarm: cloudwatch.Alarm;
    highMemoryAlarm: cloudwatch.Alarm;
    highRequestRateAlarm: cloudwatch.Alarm;
    highResponseTimeAlarm: cloudwatch.Alarm;
    customRpsAlarm: cloudwatch.Alarm;
  };
}

export class AutoScalingStack extends cdk.Stack {
  public readonly scalingTarget: applicationautoscaling.ScalableTarget;
  public readonly scaleOutPolicy: applicationautoscaling.StepScalingPolicy;
  public readonly scaleInPolicy: applicationautoscaling.StepScalingPolicy;

  constructor(scope: Construct, id: string, props: AutoScalingStackProps) {
    super(scope, id, props);

    const { ecsService, alarms } = props;

    // Auto Scaling 대상 설정
    this.scalingTarget = new applicationautoscaling.ScalableTarget(
      this,
      "EcsScalingTarget",
      {
        serviceNamespace: applicationautoscaling.ServiceNamespace.ECS,
        resourceId: `service/${ecsService.cluster.clusterName}/${ecsService.serviceName}`,
        scalableDimension: "ecs:service:DesiredCount",
        minCapacity: 2,
        maxCapacity: 100,
      }
    );

    // === Step Scaling 정책 - Scale Out (확장) ===
    this.scaleOutPolicy = new applicationautoscaling.StepScalingPolicy(
      this,
      "ScaleOutPolicy",
      {
        scalingTarget: this.scalingTarget,
        metric: new cloudwatch.Metric({
          namespace: "FastScaling/Application",
          metricName: "RequestsPerSecond",
          statistic: "Average",
          period: cdk.Duration.seconds(10),
        }),
        adjustmentType: applicationautoscaling.AdjustmentType.CHANGE_IN_CAPACITY,
        cooldown: cdk.Duration.seconds(10), // 10초 쿨다운 (매우 빠른 반응)
        metricAggregationType: applicationautoscaling.MetricAggregationType.AVERAGE,
        scalingSteps: [
          {
            lower: 100,
            upper: 150,
            change: 1,
          },
          {
            lower: 150,
            upper: 200,
            change: 2,
          },
          {
            lower: 200,
            change: 4,
          },
        ],
      }
    );

    // === Step Scaling 정책 - Scale In (축소) ===
    this.scaleInPolicy = new applicationautoscaling.StepScalingPolicy(
      this,
      "ScaleInPolicy",
      {
        scalingTarget: this.scalingTarget,
        metric: new cloudwatch.Metric({
          namespace: "FastScaling/Application",
          metricName: "RequestsPerSecond",
          statistic: "Average",
          period: cdk.Duration.seconds(60),
        }),
        adjustmentType: applicationautoscaling.AdjustmentType.CHANGE_IN_CAPACITY,
        cooldown: cdk.Duration.seconds(300), // 5분 쿨다운 (보수적 축소)
        metricAggregationType: applicationautoscaling.MetricAggregationType.AVERAGE,
        scalingSteps: [
          {
            upper: 30,
            change: -2, // 매우 낮은 RPS일 때 더 적극적으로 축소
          },
          {
            upper: 50,
            change: -1, // 낮은 RPS일 때 점진적 축소
          },
        ],
      }
    );

    // === 추가 스케일링 정책들 ===

    // CPU 기반 스케일링 정책
    const cpuScaleOutPolicy = new applicationautoscaling.StepScalingPolicy(
      this,
      "CpuScaleOutPolicy",
      {
        scalingTarget: this.scalingTarget,
        metric: new cloudwatch.Metric({
          namespace: "AWS/ECS",
          metricName: "CPUUtilization",
          dimensionsMap: {
            ServiceName: ecsService.serviceName,
            ClusterName: ecsService.cluster.clusterName,
          },
          statistic: "Average",
          period: cdk.Duration.seconds(60),
        }),
        adjustmentType: applicationautoscaling.AdjustmentType.CHANGE_IN_CAPACITY,
        cooldown: cdk.Duration.seconds(60),
        metricAggregationType: applicationautoscaling.MetricAggregationType.AVERAGE,
        scalingSteps: [
          {
            lower: 70,
            upper: 90, // 70-90% CPU
            change: 1,
          },
          {
            lower: 90, // 90%+ CPU
            change: 2,
          },
        ],
      }
    );

    // 메모리 기반 스케일링 정책
    const memoryScaleOutPolicy = new applicationautoscaling.StepScalingPolicy(
      this,
      "MemoryScaleOutPolicy",
      {
        scalingTarget: this.scalingTarget,
        metric: new cloudwatch.Metric({
          namespace: "AWS/ECS",
          metricName: "MemoryUtilization",
          dimensionsMap: {
            ServiceName: ecsService.serviceName,
            ClusterName: ecsService.cluster.clusterName,
          },
          statistic: "Average",
          period: cdk.Duration.seconds(60),
        }),
        adjustmentType: applicationautoscaling.AdjustmentType.CHANGE_IN_CAPACITY,
        cooldown: cdk.Duration.seconds(60),
        metricAggregationType: applicationautoscaling.MetricAggregationType.AVERAGE,
        scalingSteps: [
          {
            lower: 80,
            upper: 90,
            change: 1, // 80-90% 메모리 사용률
          },
          {
            lower: 90,
            change: 2, // 90%+ 메모리 사용률은 더 적극적으로 확장
          },
        ],
      }
    );

    // === Target Tracking 스케일링 (보조적 역할) ===

    // CPU 기반 Target Tracking (백업용)
    this.scalingTarget.scaleToTrackMetric("CpuTargetTracking", {
      targetValue: 60,
      predefinedMetric: applicationautoscaling.PredefinedMetric.ECS_SERVICE_AVERAGE_CPU_UTILIZATION,
      scaleInCooldown: cdk.Duration.seconds(300),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    // === 예측적 스케일링 (Scheduled Scaling) ===

    // 비즈니스 시간 대비 사전 스케일링
    this.scalingTarget.scaleOnSchedule("MorningScaleOut", {
      schedule: applicationautoscaling.Schedule.cron({
        hour: "8",
        minute: "30",
      }),
      minCapacity: 5, // 아침 9시 전에 미리 확장
      maxCapacity: 100,
    });

    // 야간 시간 스케일 다운
    this.scalingTarget.scaleOnSchedule("EveningScaleIn", {
      schedule: applicationautoscaling.Schedule.cron({
        hour: "22",
        minute: "0",
      }),
      minCapacity: 2, // 밤 10시 이후 최소 유지
      maxCapacity: 100,
    });

    // 주말 최소 운영
    this.scalingTarget.scaleOnSchedule("WeekendScaleDown", {
      schedule: applicationautoscaling.Schedule.cron({
        hour: "23",
        minute: "0",
        weekDay: "FRI",
      }),
      minCapacity: 1, // 주말은 최소 운영
      maxCapacity: 100,
    });

    this.scalingTarget.scaleOnSchedule("WeekendScaleUp", {
      schedule: applicationautoscaling.Schedule.cron({
        hour: "7",
        minute: "0",
        weekDay: "MON",
      }),
      minCapacity: 2, // 월요일 아침 복원
      maxCapacity: 100,
    });

    // Outputs
    new cdk.CfnOutput(this, "ScalingTargetId", {
      value: this.scalingTarget.scalableTargetId,
      description: "Auto Scaling Target ID",
      exportName: "FastScaling-ScalingTargetId",
    });

    // 태그 추가
    cdk.Tags.of(this.scalingTarget).add("Component", "AutoScaling");
  }
}
