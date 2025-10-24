#!/bin/bash

# Blue/Green 배포 스크립트
set -e

IMAGE_TAG=${1:-latest}
CLUSTER_NAME="fast-scaling-cluster"
SERVICE_NAME="fast-scaling-service"
TASK_FAMILY="fast-scaling-task"

echo "🔵 Blue/Green 배포 시작..."

# 1. 현재 태스크 정의 가져오기
echo "📋 현재 태스크 정의 조회..."
TASK_DEF=$(aws ecs describe-task-definition \
  --task-definition $TASK_FAMILY \
  --query taskDefinition)

# 2. 새 이미지로 태스크 정의 업데이트
echo "🔄 새 태스크 정의 생성..."
NEW_IMAGE="010928189167.dkr.ecr.ap-northeast-2.amazonaws.com/fast-scaling-app:$IMAGE_TAG"

NEW_TASK_DEF=$(echo $TASK_DEF | jq \
  --arg IMAGE "$NEW_IMAGE" \
  '.containerDefinitions[0].image = $IMAGE | 
   del(.taskDefinitionArn) | 
   del(.revision) | 
   del(.status) | 
   del(.requiresAttributes) | 
   del(.placementConstraints) | 
   del(.compatibilities) | 
   del(.registeredAt) | 
   del(.registeredBy)')

# 3. 새 태스크 정의 등록
echo "📝 새 태스크 정의 등록..."
NEW_REVISION=$(echo $NEW_TASK_DEF | aws ecs register-task-definition \
  --cli-input-json file:///dev/stdin \
  --query 'taskDefinition.revision')

echo "✅ 새 리비전: $NEW_REVISION"

# 4. 서비스 업데이트 (Blue/Green)
echo "🔄 서비스 업데이트 중..."
aws ecs update-service \
  --cluster $CLUSTER_NAME \
  --service $SERVICE_NAME \
  --task-definition $TASK_FAMILY:$NEW_REVISION

# 5. 배포 상태 모니터링
echo "👀 배포 상태 모니터링..."
aws ecs wait services-stable \
  --cluster $CLUSTER_NAME \
  --services $SERVICE_NAME

echo "🎉 Blue/Green 배포 완료!"
