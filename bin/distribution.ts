#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { DistributionStack } from '../lib/cdk-s3-distribution-stack';

const BUCKET_NAME = 'my-unique-bucket-name';
const DOMAIN_NAME = 'mydomain.com';

const app = new cdk.App();
new DistributionStack(app, 'CdkS3DistributionStack', {
    bucketName: BUCKET_NAME,
    domainName: DOMAIN_NAME
});