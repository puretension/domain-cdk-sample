import * as cdk from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export class SimpleGitHubPipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 기존 ECR Repository 사용
    const ecrRepo = ecr.Repository.fromRepositoryName(this, 'ExistingRepo', 'fast-scaling-app');

    // CodeBuild Project (GitHub 소스, webhook 없음)
    const buildProject = new codebuild.Project(this, 'FastScalingBuild', {
      projectName: 'fast-scaling-github-build',
      source: codebuild.Source.gitHub({
        owner: 'serithemage',
        repo: 'ecs-fargate-fast-scaleout',
        // webhook 제거 (수동 빌드)
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        privileged: true,
        environmentVariables: {
          AWS_DEFAULT_REGION: { value: this.region },
          AWS_ACCOUNT_ID: { value: this.account },
          IMAGE_REPO_NAME: { value: ecrRepo.repositoryName },
        },
      },
      buildSpec: codebuild.BuildSpec.fromSourceFilename('buildspec.yml'),
    });

    // ECR 권한 부여
    ecrRepo.grantPullPush(buildProject);

    // Outputs
    new cdk.CfnOutput(this, 'GitHubRepo', {
      value: 'https://github.com/serithemage/ecs-fargate-fast-scaleout',
      description: 'GitHub Repository URL',
    });

    new cdk.CfnOutput(this, 'CodeBuildProject', {
      value: buildProject.projectName,
      description: 'CodeBuild Project Name',
    });

    new cdk.CfnOutput(this, 'ECRRepoUri', {
      value: ecrRepo.repositoryUri,
      description: 'ECR Repository URI',
    });
  }
}
