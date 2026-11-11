import { describe, it, expect } from 'vitest';
import { YAML_CONFIG, TOML_CONFIG, TERRAFORM_CONFIG, JSON_CONFIG } from '../core/graph/sync/languages/infra.js';

describe('infra language configs', () => {
    describe('YAML_CONFIG', () => {
        it('matches yaml files except docker-compose', () => {
            expect(YAML_CONFIG.matchesFile('k8s/deployment.yaml')).toBe(true);
            expect(YAML_CONFIG.matchesFile('service.yml')).toBe(true);
            expect(YAML_CONFIG.matchesFile('docker-compose.yml')).toBe(false);
            expect(YAML_CONFIG.matchesFile('compose.yaml')).toBe(false);
            expect(YAML_CONFIG.matchesFile('index.js')).toBe(false);
        });

        it('extracts k8s resources and container ports', () => {
            const yaml = [
                '# K8s deployment service',
                'apiVersion: apps/v1',
                'kind: Deployment',
                'metadata:',
                '  name: my-app',
                'spec:',
                '  template:',
                '    spec:',
                '      containers:',
                '        - name: web',
                '          image: node:18',
                '          containerPort: 8080'
            ].join('\n');

            const result = YAML_CONFIG.extract(yaml);
            expect(result.purpose).toContain('K8s deployment service');
            expect(result.symbols).toContain('kind');
            expect(result.symbols).toContain('Deployment');
            expect(result.symbols).toContain('my-app');
            expect(result.symbols).toContain('web');
            expect(result.symbols).toContain('port:8080');
            expect(result.imports).toContain('node:18');
        });

        it('extracts ansible roles and tasks', () => {
            const yaml = [
                '- hosts: all, webservers',
                '  tasks:',
                '  - nginx_setup'
            ].join('\n');

            const result = YAML_CONFIG.extract(yaml);
            expect(result.imports).toContain('all');
            expect(result.imports).toContain('webservers');
            expect(result.symbols).toContain('nginx_setup');
        });

        it('extracts serverless functions', () => {
            const yaml = [
                'service: my-service',
                'provider:',
                '  name: aws',
                'functions:',
                '  helloWorld:',
                '    handler: index.handler'
            ].join('\n');

            const result = YAML_CONFIG.extract(yaml);
            expect(result.symbols).toContain('helloWorld');
            expect(result.exports).toContain('helloWorld');
        });
    });

    describe('TOML_CONFIG', () => {
        it('extracts tables and key-value pairs', () => {
            const toml = [
                '# Package config',
                '[package]',
                'name = "lady-lens"',
                'repository = "https://github.com/example/lady-lens"'
            ].join('\n');

            const result = TOML_CONFIG.extract(toml);
            expect(result.purpose).toContain('Package config');
            expect(result.symbols).toContain('package');
            expect(result.symbols).toContain('name');
            expect(result.exports).toContain('package');
            expect(result.imports).toContain('https://github.com/example/lady-lens');
        });
    });

    describe('TERRAFORM_CONFIG', () => {
        it('extracts resources, modules, providers and calls', () => {
            const tf = [
                '// Main infrastructure',
                'resource "aws_s3_bucket" "bucket" {',
                '  bucket = "my-bucket"',
                '}',
                'provider "aws" {',
                '  region = "eu-west-1"',
                '}',
                'source = "git::https://example.com/mod.git"',
                'var = "${file("foo.txt")}"'
            ].join('\n');

            const result = TERRAFORM_CONFIG.extract(tf);
            expect(result.purpose).toContain('Main infrastructure');
            expect(result.symbols).toContain('bucket');
            expect(result.symbols).toContain('resource:aws_s3_bucket:bucket');
            expect(result.symbols).toContain('aws');
            expect(result.exports).toContain('bucket');
            expect(result.imports).toContain('git::https://example.com/mod.git');
            expect(result.calls).toEqual([['terraform', 'file', 9]]);
        });
    });

    describe('JSON_CONFIG', () => {
        it('matches config json files and extracts dependencies and scripts', () => {
            expect(JSON_CONFIG.matchesFile('package.json')).toBe(true);
            expect(JSON_CONFIG.matchesFile('tsconfig.json')).toBe(true);
            expect(JSON_CONFIG.matchesFile('random.json')).toBe(false);

            const json = JSON.stringify({
                name: 'my-package',
                version: '1.2.3',
                dependencies: { express: '^4.0.0' },
                scripts: { build: 'vitest run' }
            });

            const result = JSON_CONFIG.extract(json);
            expect(result.symbols).toContain('my-package');
            expect(result.symbols).toContain('v1.2.3');
            expect(result.symbols).toContain('build');
            expect(result.imports).toContain('express');
            expect(result.functions.length).toBe(1);
            expect(result.functions[0].name).toBe('build');
        });

        it('handles malformed json gracefully', () => {
            const result = JSON_CONFIG.extract('{ invalid json');
            expect(result.parseError).toBeTruthy();
        });
    });
});
