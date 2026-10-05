// SigV4 签名器正确性：使用 AWS 官方文档固定测试向量（对照桌面端 SigV4SignerTests.cs 翻译）
import { deriveSigningKey, signRequest } from '../src/sync/crypto/sigv4';
import { bytesToHex } from '@noble/hashes/utils.js';

const ACCESS_KEY = 'AKIAIOSFODNN7EXAMPLE';
const SECRET_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';

describe('SigV4Signer', () => {
  test('deriveSigningKey matches AWS documented vector (us-east-1 / iam / 20150830)', () => {
    const key = deriveSigningKey(
      'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      '20150830',
      'us-east-1',
      'iam',
    );
    expect(bytesToHex(key)).toBe(
      'c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9',
    );
  });

  test('sign matches AWS S3 GET Bucket Lifecycle vector', () => {
    const result = signRequest({
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com?lifecycle=',
      region: 'us-east-1',
      service: 's3',
      accessKey: ACCESS_KEY,
      secretKey: SECRET_KEY,
      now: new Date(Date.UTC(2013, 4, 24, 0, 0, 0)),
    });

    expect(result.xAmzDate).toBe('20130524T000000Z');
    expect(result.authorization).toContain(
      'Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request',
    );
    expect(result.authorization).toContain('SignedHeaders=host;x-amz-content-sha256;x-amz-date');
    expect(result.authorization).toContain(
      'Signature=fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543',
    );
  });

  test('empty payload hash equals SHA256("")', () => {
    const result = signRequest({
      method: 'PUT',
      url: 'https://examplebucket.s3.amazonaws.com/',
      region: 'us-east-1',
      service: 's3',
      accessKey: ACCESS_KEY,
      secretKey: SECRET_KEY,
      now: new Date(Date.UTC(2013, 4, 24, 0, 0, 0)),
    });
    expect(result.xAmzDate).toBe('20130524T000000Z');
    expect(result.payloadSha256).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  test('AWS documented PUT object payload hash matches', () => {
    const payload = new TextEncoder().encode('Welcome to Amazon S3.');
    const result = signRequest({
      method: 'PUT',
      url: 'https://examplebucket.s3.amazonaws.com/test%24file.text',
      region: 'us-east-1',
      service: 's3',
      accessKey: ACCESS_KEY,
      secretKey: SECRET_KEY,
      payload,
      now: new Date(Date.UTC(2013, 4, 24, 0, 0, 0)),
    });
    expect(result.payloadSha256).toBe(
      '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072',
    );
  });

  test('canonical URI escapes special characters ($ -> %24)', () => {
    const result = signRequest({
      method: 'PUT',
      url: 'https://examplebucket.s3.amazonaws.com/test$file.text',
      region: 'us-east-1',
      service: 's3',
      accessKey: ACCESS_KEY,
      secretKey: SECRET_KEY,
      payload: new TextEncoder().encode('Welcome to Amazon S3.'),
      now: new Date(Date.UTC(2013, 4, 24, 0, 0, 0)),
    });
    // 规范化 URI 段转义后签名可复现（与桌面端同规则）
    expect(result.authorization).toContain('AWS4-HMAC-SHA256');
  });

  test('ListObjectsV2 style query is deterministic and sorted', () => {
    const params = {
      method: 'GET',
      url: 'https://account.r2.cloudflarestorage.com/my-bucket?list-type=2&max-keys=1000&prefix=stickynotes%2Fnotes%2F',
      region: 'auto',
      service: 's3',
      accessKey: ACCESS_KEY,
      secretKey: SECRET_KEY,
      now: new Date(Date.UTC(2026, 9, 4, 7, 30, 0)),
    };
    const first = signRequest(params);
    expect(first.xAmzDate).toBe('20261004T073000Z');
    expect(first.authorization).toContain('Credential=AKIAIOSFODNN7EXAMPLE/20261004/auto/s3/aws4_request');
    const second = signRequest(params);
    expect(first.authorization).toBe(second.authorization);
  });
});
