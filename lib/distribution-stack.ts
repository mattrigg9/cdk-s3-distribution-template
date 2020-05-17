import { Duration, App, Stack, StackProps } from "@aws-cdk/core";
import { Bucket } from "@aws-cdk/aws-s3";
import {
  Alarm,
  ComparisonOperator,
  Metric,
  Unit,
  TreatMissingData,
} from "@aws-cdk/aws-cloudwatch";
import {
  CloudFrontWebDistribution,
  CloudFrontAllowedMethods,
  ViewerProtocolPolicy,
  HttpVersion,
  PriceClass,
  OriginAccessIdentity,
  SecurityPolicyProtocol,
  SSLMethod
} from "@aws-cdk/aws-cloudfront";
import { DnsValidatedCertificate } from "@aws-cdk/aws-certificatemanager";
import { HostedZone, IHostedZone } from "@aws-cdk/aws-route53";

interface DistributionStackProps extends StackProps {
  bucketName: string;
  domainName: string;
}

export class DistributionStack extends Stack {
  cloudFrontDistribution: CloudFrontWebDistribution;

  constructor(scope: App, id: string, props: DistributionStackProps) {
    super(scope, id, props);

    const { domainName, bucketName } = props;

    const bucketSource = this.buildAppBucket(bucketName);
    const hostedZone = this.lookupHostedZone(domainName);
    const certificate = this.buildDistributionCertificate(domainName, hostedZone);
    const distribution = this.buildCloudFrontDistribution(bucketSource, domainName, certificate);
    this.buildAlarms(distribution);
  }

  /**
   * Function that initializes hosted zone from assumed existing Route53 configuration.
   */
  lookupHostedZone(domainName: string, privateZone: boolean = false): IHostedZone {
    return HostedZone.fromLookup(this, "HostedZone", {
      domainName,
      privateZone,
    });
  }

  buildAppBucket(bucketName: string): Bucket {
    return new Bucket(this, "AppBucket", {
      bucketName,
    });
  }

  /**
   * This function created a new ACM certificate and automatically validates it via Route53 
   * DNS validation. This function assumes you have an existing Route53 hosted zone.
   * https://docs.aws.amazon.com/cdk/api/latest/docs/aws-certificatemanager-readme.html
   */
  buildDistributionCertificate(domainName: string, hostedZone: IHostedZone): DnsValidatedCertificate {
    return new DnsValidatedCertificate(this, "DistributionCertificate", {
      domainName,
      hostedZone,
    });
  }

  buildCloudFrontDistribution(
    bucketSource: Bucket,
    domainName: string,
    certificate: DnsValidatedCertificate
  ): CloudFrontWebDistribution {
    const originAccessIdentity = new OriginAccessIdentity(
      this,
      "AppDistributionOAI"
    );

    const distribution = new CloudFrontWebDistribution(
      this,
      "AppDistribution",
      {
        comment: "App Distribution",
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        httpVersion: HttpVersion.HTTP2,
        defaultRootObject: "index.html",
        priceClass: PriceClass.PRICE_CLASS_100,
        aliasConfiguration: {
          // Note: Cannot use Certificate CDK resource, as ACM cert needs to be in us-east-1
          // and CDK does not offer x-region references at this time
          acmCertRef: certificate.certificateArn,
          names: [domainName],
          securityPolicy: SecurityPolicyProtocol.TLS_V1_2_2018,
          sslMethod: SSLMethod.SNI,
        },
        // Optional, used to support SPA routing
        // https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-cloudfront-distribution-customerrorresponse.html
        errorConfigurations: [
          {
            errorCode: 404,
            responseCode: 200,
            responsePagePath: "/index.html",
          },
        ],
        originConfigs: [
          {
            s3OriginSource: {
              // CDK Automatically adds OAI user to the bucket policy
              originAccessIdentity,
              s3BucketSource: bucketSource,
            },
            behaviors: [
              {
                allowedMethods: CloudFrontAllowedMethods.GET_HEAD,
                compress: true,
                forwardedValues: {
                  queryString: false,
                  cookies: {
                    forward: "none",
                  },
                },
                isDefaultBehavior: false,
              },
            ],
          },
        ],
      }
    );

    return distribution;
  }

  buildAlarms(cloudFrontDistribution: CloudFrontWebDistribution): void {
    /**
     * Server response code alarms
     */
    const clientHttpErrorMetric = new Metric({
      metricName: "4xxErrorRate",
      namespace: "AWS/CloudFront",
      period: Duration.seconds(3600),
      statistic: "Average",
      unit: Unit.COUNT,
      dimensions: {
        Region: "Global",
        DistributionId: cloudFrontDistribution.distributionId,
      },
    });
    new Alarm(this, "ClientHttpErrorAlarm", {
      alarmDescription: "CloudFront4XX Errors",
      alarmName: "CloudFront4XX",
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      metric: clientHttpErrorMetric,
      threshold: 2,
      treatMissingData: TreatMissingData.MISSING,
    });

    const serverHttpErrorMetric = new Metric({
      metricName: "5xxErrorRate",
      namespace: "AWS/CloudFront",
      period: Duration.seconds(3600),
      statistic: "Average",
      unit: Unit.COUNT,
      dimensions: {
        Region: "Global",
        DistributionId: cloudFrontDistribution.distributionId,
      },
    });
    new Alarm(this, "ServerHttpErrorAlarm", {
      alarmDescription: "CloudFront5XX Errors",
      alarmName: "CloudFront5XX",
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      metric: serverHttpErrorMetric,
      threshold: 1,
      treatMissingData: TreatMissingData.MISSING,
    });
  }
}
