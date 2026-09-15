#!/usr/bin/env bash
# Creates ISOLATED staging AWS resources so staging can never touch prod data:
#   S3 bucket the-record-media-staging, KMS key alias/the-record-articles-staging,
#   IAM user the-record-app-staging (+ scoped policy + one access key).
# Run from your laptop as michael-t:  bash deploy/aws-staging.sh
# Prints the values to paste into /var/www/record-staging/.env at the end. Idempotent.
set -euo pipefail
export AWS_REGION=us-east-1
ACCT=561226079992
BUCKET=the-record-media-staging
USER=the-record-app-staging
ALIAS=alias/the-record-articles-staging
STAGING_ORIGIN=https://recordstaging.mtrokel.org

echo "== IAM user"
aws iam get-user --user-name "$USER" >/dev/null 2>&1 || aws iam create-user --user-name "$USER" --tags Key=app,Value=the-record Key=env,Value=staging >/dev/null

echo "== KMS key (us-east-1 — check: $(aws configure get region || echo unset))"
if ! aws kms describe-key --key-id "$ALIAS" >/dev/null 2>&1; then
  KEY_ID=$(aws kms create-key --region us-east-1 --description "The Record STAGING — envelope encryption KEK" \
    --key-usage ENCRYPT_DECRYPT --key-spec SYMMETRIC_DEFAULT --tags TagKey=app,TagValue=the-record TagKey=env,TagValue=staging \
    --query KeyMetadata.KeyId --output text)
  aws kms create-alias --alias-name "$ALIAS" --target-key-id "$KEY_ID"
  aws kms enable-key-rotation --key-id "$KEY_ID"
fi
KEY_ARN=$(aws kms describe-key --key-id "$ALIAS" --query KeyMetadata.Arn --output text)
KEY_ID=$(aws kms describe-key --key-id "$ALIAS" --query KeyMetadata.KeyId --output text)
aws kms put-key-policy --key-id "$KEY_ID" --policy-name default --policy "{
  \"Version\": \"2012-10-17\", \"Id\": \"the-record-articles-staging-key-policy\",
  \"Statement\": [
    {\"Sid\":\"EnableRootAccountAdmin\",\"Effect\":\"Allow\",\"Principal\":{\"AWS\":\"arn:aws:iam::$ACCT:root\"},\"Action\":\"kms:*\",\"Resource\":\"*\"},
    {\"Sid\":\"AllowKeyAdministrators\",\"Effect\":\"Allow\",\"Principal\":{\"AWS\":\"arn:aws:iam::$ACCT:user/michael-t\"},
     \"Action\":[\"kms:Create*\",\"kms:Describe*\",\"kms:Enable*\",\"kms:List*\",\"kms:Put*\",\"kms:Update*\",\"kms:Revoke*\",\"kms:Disable*\",\"kms:Get*\",\"kms:Delete*\",\"kms:TagResource\",\"kms:UntagResource\",\"kms:ScheduleKeyDeletion\",\"kms:CancelKeyDeletion\"],\"Resource\":\"*\"},
    {\"Sid\":\"AllowAppToUseKey\",\"Effect\":\"Allow\",\"Principal\":{\"AWS\":\"arn:aws:iam::$ACCT:user/$USER\"},
     \"Action\":[\"kms:GenerateDataKey\",\"kms:Decrypt\"],\"Resource\":\"*\",
     \"Condition\":{\"StringLike\":{\"kms:EncryptionContext:recordType\":\"*\",\"kms:EncryptionContext:recordId\":\"*\"}}},
    {\"Sid\":\"AllowAppToDescribeKey\",\"Effect\":\"Allow\",\"Principal\":{\"AWS\":\"arn:aws:iam::$ACCT:user/$USER\"},\"Action\":\"kms:DescribeKey\",\"Resource\":\"*\"}
  ]}"

echo "== S3 bucket (same shape as the-record-media)"
aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null || aws s3api create-bucket --bucket "$BUCKET" --region us-east-1 >/dev/null
aws s3api put-bucket-tagging --bucket "$BUCKET" --tagging 'TagSet=[{Key=app,Value=the-record},{Key=env,Value=staging}]'
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false
aws s3api put-bucket-ownership-controls --bucket "$BUCKET" --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'
aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'
aws s3api put-bucket-policy --bucket "$BUCKET" --policy "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Sid\":\"PublicReadOnUploadsPrefix\",\"Effect\":\"Allow\",\"Principal\":\"*\",\"Action\":\"s3:GetObject\",\"Resource\":\"arn:aws:s3:::$BUCKET/uploads/*\"}]}"
aws s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration "{\"CORSRules\":[{\"AllowedHeaders\":[\"*\"],\"AllowedMethods\":[\"PUT\",\"GET\",\"HEAD\"],\"AllowedOrigins\":[\"http://localhost:3000\",\"$STAGING_ORIGIN\"],\"ExposeHeaders\":[\"ETag\"],\"MaxAgeSeconds\":3000}]}"
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration '{"Rules":[{"ID":"abort-multipart","Status":"Enabled","Filter":{},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":7}}]}'

echo "== IAM policy for $USER (mirrors prod's two inline policies, scoped to staging resources)"
aws iam put-user-policy --user-name "$USER" --policy-name AppScopedAccess --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [
    {\"Sid\":\"UseStagingKey\",\"Effect\":\"Allow\",\"Action\":[\"kms:GenerateDataKey\",\"kms:Decrypt\",\"kms:DescribeKey\"],\"Resource\":\"$KEY_ARN\"},
    {\"Sid\":\"MediaWrite\",\"Effect\":\"Allow\",\"Action\":[\"s3:PutObject\",\"s3:DeleteObject\"],\"Resource\":\"arn:aws:s3:::$BUCKET/uploads/*\"},
    {\"Sid\":\"IssuePdfReadWrite\",\"Effect\":\"Allow\",\"Action\":[\"s3:PutObject\",\"s3:DeleteObject\",\"s3:GetObject\"],\"Resource\":\"arn:aws:s3:::$BUCKET/issue-pdfs/*\"}
  ]}"

echo "== access key (only created if the user has none)"
if [[ $(aws iam list-access-keys --user-name "$USER" --query 'length(AccessKeyMetadata)') == "0" ]]; then
  CREDS=$(aws iam create-access-key --user-name "$USER" --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)
  AKID=${CREDS%%	*}; SECRET=${CREDS##*	}
else
  AKID="(existing — see aws iam list-access-keys --user-name $USER)"; SECRET="(not retrievable; create a new key if lost)"
fi

cat <<ENV

# ---- paste into /var/www/record-staging/.env ----
AWS_ACCESS_KEY_ID=$AKID
AWS_SECRET_ACCESS_KEY=$SECRET
AWS_REGION=us-east-1
AWS_S3_BUCKET=$BUCKET
KMS_KEY_ARN=$KEY_ARN
# --------------------------------------------------
ENV
