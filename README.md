# ECS Fargate 고속 스케일링 솔루션 🚀

> AWS ECS Fargate 환경에서 급증하는 트래픽에 **10초 이내**로 대응하는 고속 자동 스케일링 아키텍처

## ✨ 주요 성과

- ⚡ **10초 이내** 스케일링 반응 시간 달성
- 📊 5초 간격 고해상도 CloudWatch 메트릭
- 🎯 RPS 기반 정확한 스케일링
- 🔄 Blue/Green 배포 준비 완료
- 🛠️ GitHub + CodeBuild CI 파이프라인

## 🏗️ 아키텍처

4개의 독립적인 CDK 스택:
1. **NetworkStack**: VPC, ALB, 보안 그룹
2. **EcsStack**: Fargate 클러스터 및 서비스  
3. **MonitoringStack**: CloudWatch 메트릭 및 알람
4. **AutoScalingStack**: 고속 스케일링 정책

## 🚀 빠른 시작

```bash
# 1. 저장소 클론
git clone https://github.com/puretension/domain-cdk-sample.git
cd domain-cdk-sample

# 2. CDK 배포
cd cdk
npm install
npx cdk bootstrap
npm run deploy

# 3. 애플리케이션 배포
cd ../app
docker buildx build --platform linux/amd64 -t fast-scaling-app .
```

## 📊 성능 테스트

```bash
# ALB 엔드포인트 확인
ALB_DNS=$(aws elbv2 describe-load-balancers --names fast-scaling-alb --query 'LoadBalancers[0].DNSName' --output text)

# 부하 테스트로 스케일링 확인
for i in {1..100}; do curl http://$ALB_DNS/load/5 & done
```

## 🎯 핵심 기능

- **초고속 스케일링**: CloudWatch 고해상도 메트릭으로 10초 이내 반응
- **정확한 메트릭**: 초당 요청 수(RPS) 기반 스케일링
- **비용 효율성**: 필요한 만큼만 스케일링하는 보수적 정책
- **안정성**: 최소 작업 수 유지 및 진동 방지

---
*Infrastructure as Code로 구현된 엔터프라이즈급 ECS Fargate 솔루션*
