import * as cdk from 'aws-cdk-lib';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codedeploy from 'aws-cdk-lib/aws-codedeploy';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

interface PipelineStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  listener: elbv2.ApplicationListener;
  targetGroup: elbv2.ApplicationTargetGroup;
}

export class PipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);

    // 하드코딩된 값으로 클러스터와 서비스 참조
    const cluster = ecs.Cluster.fromClusterArn(this, 'ImportedCluster', 
      `arn:aws:ecs:${this.region}:${this.account}:cluster/fast-scaling-cluster`);

    // 서비스 import  
    const service = ecs.FargateService.fromFargateServiceAttributes(this, 'ImportedService', {
      cluster: cluster,
      serviceName: 'fast-scaling-service',
    });

    // 기존 ECR Repository 사용
    const ecrRepo = ecr.Repository.fromRepositoryName(this, 'ExistingRepo', 'fast-scaling-app');

    // GitHub 사용 (CodeCommit 서비스 중단됨)
    // 수동으로 GitHub 저장소 생성 필요

    // CodeBuild Service Role
    const codeBuildRole = new iam.Role(this, 'CodeBuildRole', {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryPowerUser'),
      ],
      inlinePolicies: {
        CodeBuildPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:PutLogEvents',
              ],
              resources: ['*'],
            }),
          ],
        }),
      },
    });

    // CodeBuild Project (GitHub 소스)
    const buildProject = new codebuild.Project(this, 'FastScalingBuild', {
      projectName: 'fast-scaling-build',
      source: codebuild.Source.gitHub({
        owner: 'serithemage', // GitHub 사용자명
        repo: 'ecs-fargate-fast-scaleout',
        webhook: true, // 자동 빌드 트리거
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        privileged: true, // Docker 빌드용
        environmentVariables: {
          AWS_DEFAULT_REGION: {
            value: this.region,
          },
          AWS_ACCOUNT_ID: {
            value: this.account,
          },
          IMAGE_REPO_NAME: {
            value: ecrRepo.repositoryName,
          },
        },
      },
      role: codeBuildRole,
      buildSpec: codebuild.BuildSpec.fromSourceFilename('buildspec.yml'),
    });

    // Blue/Green용 추가 Target Group
    const greenTargetGroup = new elbv2.ApplicationTargetGroup(this, 'GreenTargetGroup', {
      vpc: props.vpc,
      port: 8080,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        enabled: true,
        healthyHttpCodes: '200',
        interval: cdk.Duration.seconds(5),
        timeout: cdk.Duration.seconds(4),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 2,
        path: '/health',
        protocol: elbv2.Protocol.HTTP,
      },
    });

    // CodeDeploy Application
    const codeDeployApp = new codedeploy.EcsApplication(this, 'FastScalingApp', {
      applicationName: 'fast-scaling-app',
    });

    // CodeDeploy Deployment Group
    const deploymentGroup = new codedeploy.EcsDeploymentGroup(this, 'FastScalingDeploymentGroup', {
      application: codeDeployApp,
      deploymentGroupName: 'fast-scaling-deployment-group',
      service: service,
      blueGreenDeploymentConfig: {
        listener: props.listener,
        blueTargetGroup: props.targetGroup,
        greenTargetGroup: greenTargetGroup,
        deploymentApprovalWaitTime: cdk.Duration.minutes(0), // 자동 승인
        terminationWaitTime: cdk.Duration.minutes(5),
      },
      deploymentConfig: codedeploy.EcsDeploymentConfig.CANARY_10PERCENT_5MINUTES,
    });

    // Pipeline Artifacts
    const sourceOutput = new codepipeline.Artifact('SourceOutput');
    const buildOutput = new codepipeline.Artifact('BuildOutput');

    // CodePipeline
    const pipeline = new codepipeline.Pipeline(this, 'FastScalingPipeline', {
      pipelineName: 'fast-scaling-pipeline',
      stages: [
        {
          stageName: 'Source',
          actions: [
            new codepipeline_actions.CodeCommitSourceAction({
              actionName: 'CodeCommit_Source',
              repository: codeRepo,
              output: sourceOutput,
              branch: 'main',
            }),
          ],
        },
        {
          stageName: 'Build',
          actions: [
            new codepipeline_actions.CodeBuildAction({
              actionName: 'CodeBuild',
              project: buildProject,
              input: sourceOutput,
              outputs: [buildOutput],
            }),
          ],
        },
        {
          stageName: 'Deploy',
          actions: [
            new codepipeline_actions.CodeDeployEcsDeployAction({
              actionName: 'CodeDeploy',
              deploymentGroup: deploymentGroup,
              appSpecTemplateInput: buildOutput,
              taskDefinitionTemplateInput: buildOutput,
            }),
          ],
        },
      ],
    });

    // Outputs
    new cdk.CfnOutput(this, 'CodeCommitRepoUrl', {
      value: codeRepo.repositoryCloneUrlHttp,
      description: 'CodeCommit Repository Clone URL',
    });

    new cdk.CfnOutput(this, 'ECRRepoUri', {
      value: ecrRepo.repositoryUri,
      description: 'ECR Repository URI',
    });

    new cdk.CfnOutput(this, 'PipelineName', {
      value: pipeline.pipelineName,
      description: 'CodePipeline Name',
    });
  }
}
