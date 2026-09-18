#!/usr/bin/env bash
# One-shot corrections to the PRODUCTION AWS setup, found by the 2026-09-15 audit.
# Run from your laptop as the michael-t admin user:  bash deploy/aws-fixes.sh
# Every step is idempotent and reversible (the orphan key is disabled, not deleted).
set -euo pipefail
export AWS_REGION=us-east-1
ACCT=561226079992
PROD_KEY_ARN="arn:aws:kms:us-east-1:$ACCT:key/e4ab66f6-eea5-4543-a17c-38cc6b91e93c"
ORPHAN_KEY_ID="1ce6ae79-2baa-43f3-b8f0-6457759b2c59"     # alias/the-record-articles in us-east-2, never used
BUCKET=the-record-media

echo "== 1. IAM: point UseArticlesKMSKey at the real (us-east-1) key instead of the us-east-2 orphan"
aws iam put-user-policy --user-name the-record-app --policy-name UseArticlesKMSKey --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Sid\": \"UseTheRecordArticleKey\",
    \"Effect\": \"Allow\",
    \"Action\": [\"kms:GenerateDataKey\", \"kms:Decrypt\", \"kms:DescribeKey\"],
    \"Resource\": \"$PROD_KEY_ARN\"
  }]
}"
aws iam get-user-policy --user-name the-record-app --policy-name UseArticlesKMSKey --query 'PolicyDocument.Statement[0].Resource' --output text

echo "== 2. KMS: disable the orphan us-east-2 key (re-enable with enable-key if anything breaks; schedule deletion after 30 quiet days)"
aws kms disable-key --region us-east-2 --key-id "$ORPHAN_KEY_ID"
aws kms describe-key --region us-east-2 --key-id "$ORPHAN_KEY_ID" --query 'KeyMetadata.KeyState' --output text
# later:  aws kms delete-alias --region us-east-2 --alias-name alias/the-record-articles
#         aws kms schedule-key-deletion --region us-east-2 --key-id $ORPHAN_KEY_ID --pending-window-in-days 30

echo "== 3. S3 CORS: add the staging origin (presigned PUTs happen from the browser)"
aws s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration '{"CORSRules":[{
  "AllowedHeaders":["*"],"AllowedMethods":["PUT","GET","HEAD"],
  "AllowedOrigins":["http://localhost:3000","https://record.mtrokel.org","https://recordstaging.mtrokel.org"],
  "ExposeHeaders":["ETag"],"MaxAgeSeconds":3000}]}'
aws s3api get-bucket-cors --bucket "$BUCKET" --query 'CORSRules[0].AllowedOrigins' --output text

echo "== 4. S3: versioning + lifecycle on the media bucket (undo an accidental delete for 30 days; drop stale multipart uploads)"
aws s3api put-bucket-versioning --bucket "$BUCKET" --versioning-configuration Status=Enabled
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration '{"Rules":[{
  "ID":"expire-old-versions","Status":"Enabled","Filter":{},
  "NoncurrentVersionExpiration":{"NoncurrentDays":30},
  "AbortIncompleteMultipartUpload":{"DaysAfterInitiation":7}}]}'

echo "== 5. S3: lifecycle on the CloudTrail bucket (it grows forever otherwise; 2-year retention)"
aws s3api put-bucket-lifecycle-configuration --bucket "the-record-cloudtrail-$ACCT-us-east-1" --lifecycle-configuration '{"Rules":[{
  "ID":"expire-trail-logs","Status":"Enabled","Filter":{},"Expiration":{"Days":730}}]}'

echo "== 6. Account-wide S3 public-access block (ACLs only — the uploads/* bucket policy keeps working)"
aws s3control put-public-access-block --account-id "$ACCT" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false

echo "== 7. IAM: account password policy"
aws iam update-account-password-policy --minimum-password-length 14 --require-symbols --require-numbers \
  --require-uppercase-characters --require-lowercase-characters --max-password-age 365 --password-reuse-prevention 5

echo "== 8. CloudWatch: alarms that don't exist yet (each reuses the CloudTrail log group + SNS topic)"
LOG_GROUP=/aws/cloudtrail/the-record-audit
TOPIC_ARN="arn:aws:sns:us-east-1:$ACCT:the-record-security-alerts"
mk_alarm() { # name, filter-pattern, description
  aws logs put-metric-filter --log-group-name "$LOG_GROUP" --filter-name "$1" --filter-pattern "$2" \
    --metric-transformations metricName="$1",metricNamespace=TheRecord/Security,metricValue=1,defaultValue=0
  aws cloudwatch put-metric-alarm --alarm-name "$1" --alarm-description "$3" --metric-name "$1" \
    --namespace TheRecord/Security --statistic Sum --period 300 --evaluation-periods 1 --threshold 0 \
    --comparison-operator GreaterThanThreshold --treat-missing-data notBreaching --alarm-actions "$TOPIC_ARN"
}
mk_alarm TheRecordAppAccessDenied '{ ($.userIdentity.userName = "the-record-app") && ($.errorCode = "*AccessDenied*" || $.errorCode = "*UnauthorizedOperation*") }' "the-record-app credentials being used somewhere they are not allowed"
mk_alarm TheRecordRootOrConsoleLogin '{ ($.eventName = "ConsoleLogin") }' "Console sign-in to the account"
mk_alarm TheRecordIamChange '{ ($.eventSource = "iam.amazonaws.com") && ($.eventName = Put* || $.eventName = Attach* || $.eventName = Create* || $.eventName = Delete* || $.eventName = Update*) }' "IAM users/policies/keys changed"
mk_alarm TheRecordCloudTrailTamper '{ ($.eventName = StopLogging) || ($.eventName = DeleteTrail) || ($.eventName = UpdateTrail) }' "CloudTrail turned off or altered"

echo
echo "Done. Still manual: enable MFA on michael-t (IAM console → Security credentials), then rotate both"
echo "136-day-old access keys (create new → update /var/www/record/.env + ~/.aws → set old Inactive → delete)."
