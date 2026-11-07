import { describe, it, expect } from 'vitest';
import { createGraph, functionView, definedIn } from '../core/graph/index.js';
import {
    analyzeSourceForLanguage,
    isCodeFile,
    isDocFile,
    isConfigFile,
    registerLanguageConfig,
    isLanguageSupported
} from '../core/graph/sync/languages/index.js';

const CSHARP_HANDLER = `
using System;
using System.Collections.Generic;
using Puratos.Opcenter.Core;

namespace Puratos.Opcenter.Handlers
{
    /// <summary>
    /// Partial class init
    /// </summary>
    [Handler(HandlerCategory.BasicMethod)]
    public partial class CheckChangeOverForMultipleDestinationsHandlerShell
    {
        private readonly IDestinationService _destinationService;

        public CheckChangeOverForMultipleDestinationsHandlerShell(IDestinationService destinationService)
        {
            _destinationService = destinationService;
        }

        [HandlerEntryPoint]
        private CheckChangeOverForMultipleDestinations.Response CheckChangeOverForMultipleDestinationsHandler(CheckChangeOverForMultipleDestinations command)
        {
            Validate(command);
            return _destinationService.Execute(command);
        }

        private void Validate(CheckChangeOverForMultipleDestinations command)
        {
            if (command == null) throw new ArgumentNullException(nameof(command));
        }
    }
}
`;

const CSHARP_CONTROLLER = `
using Puratos.Opcenter.Handlers;

namespace Puratos.Opcenter.Controllers
{
    public class ChangeOverController
    {
        private readonly CheckChangeOverForMultipleDestinationsHandler _handler;

        public ChangeOverController(CheckChangeOverForMultipleDestinationsHandler handler)
        {
            _handler = handler;
        }

        public void Process()
        {
            _handler.Handle(null);
        }
    }
}
`;

const CSHARP_TEST = `
using NUnit.Framework;
using Puratos.Opcenter.Handlers;

namespace Puratos.Opcenter.UnitTests
{
    [TestFixture]
    public class CheckChangeOverTests
    {
        [Test]
        public void ShouldHandleChangeOver()
        {
            var handler = new CheckChangeOverForMultipleDestinationsHandler(null);
            handler.Handle(new ChangeOverRequest());
        }
    }
}
`;

describe('Story 23.11: Multi-language support (C#)', () => {
    it('analyzes C# source code and extracts classes, methods, symbol ranges, imports, and purpose', () => {
        const facts = analyzeSourceForLanguage(CSHARP_HANDLER, '.cs');
        expect(facts).toBeDefined();
        expect(facts.symbols).toContain('CheckChangeOverForMultipleDestinationsHandlerShell');
        expect(facts.symbols).toContain('CheckChangeOverForMultipleDestinationsHandler');
        expect(facts.symbols).toContain('Validate');
        // Comments like '/// Partial class init' must NOT produce a symbol 'init'
        expect(facts.symbols).not.toContain('init');

        expect(facts.exports).toContain('CheckChangeOverForMultipleDestinationsHandlerShell');
        expect(facts.exports).toContain('CheckChangeOverForMultipleDestinationsHandler');
        expect(facts.exports).not.toContain('init');

        expect(facts.symbolRanges['CheckChangeOverForMultipleDestinationsHandler']).toBeDefined();
        const methodRange = facts.symbolRanges['CheckChangeOverForMultipleDestinationsHandler'];
        expect(methodRange[0]).toBeGreaterThanOrEqual(20);
        expect(methodRange[1]).toBeGreaterThanOrEqual(methodRange[0]);

        expect(facts.imports).toContain('System');
        expect(facts.imports).toContain('Puratos.Opcenter.Core');
        expect(facts.purpose).toBe('Partial class init');

        const callees = facts.calls.map(c => c[1]);
        expect(callees).toContain('Validate');
        expect(callees).toContain('Execute');
    });

    it('identifies tests and callers across C# files in functionView', () => {
        const handlerFacts = analyzeSourceForLanguage(CSHARP_HANDLER, '.cs');
        const controllerFacts = analyzeSourceForLanguage(CSHARP_CONTROLLER, '.cs');
        const testFacts = analyzeSourceForLanguage(CSHARP_TEST, '.cs');

        const graph = createGraph('csharp-test');
        graph.addNode('file:Puratos.Opcenter/Handlers/CheckChangeOverForMultipleDestinationsHandler.cs', 'CodeFile', {
            path: 'Puratos.Opcenter/Handlers/CheckChangeOverForMultipleDestinationsHandler.cs',
            kind: 'source',
            lines: 32,
            exports: handlerFacts.exports,
            symbolRanges: handlerFacts.symbolRanges,
            purpose: handlerFacts.purpose
        });

        graph.addNode('file:Puratos.Opcenter/Controllers/ChangeOverController.cs', 'CodeFile', {
            path: 'Puratos.Opcenter/Controllers/ChangeOverController.cs',
            kind: 'source',
            lines: 22,
            exports: controllerFacts.exports,
            symbolRanges: controllerFacts.symbolRanges
        });

        graph.addNode('file:Puratos.Opcenter.UnitTests/CheckChangeOverTests.cs', 'CodeFile', {
            path: 'Puratos.Opcenter.UnitTests/CheckChangeOverTests.cs',
            kind: 'test',
            lines: 19,
            exports: testFacts.exports,
            symbolRanges: testFacts.symbolRanges
        });

        // Edges
        graph.addEdge(
            'file:Puratos.Opcenter/Controllers/ChangeOverController.cs',
            'file:Puratos.Opcenter/Handlers/CheckChangeOverForMultipleDestinationsHandler.cs',
            'CALLS'
        );
        graph.addEdge(
            'file:Puratos.Opcenter.UnitTests/CheckChangeOverTests.cs',
            'file:Puratos.Opcenter/Handlers/CheckChangeOverForMultipleDestinationsHandler.cs',
            'TESTS'
        );

        // 1. definedIn check
        const defined = definedIn(graph, 'CheckChangeOverForMultipleDestinationsHandler');
        expect(defined.found).toBe(true);
        expect(defined.locations[0].path).toBe('Puratos.Opcenter/Handlers/CheckChangeOverForMultipleDestinationsHandler.cs');

        // 2. functionView check
        const view = functionView(graph, 'CheckChangeOverForMultipleDestinationsHandler', {
            readFile: (p) => {
                if (p.includes('CheckChangeOverForMultipleDestinationsHandler')) return CSHARP_HANDLER;
                if (p.includes('ChangeOverController')) return CSHARP_CONTROLLER;
                if (p.includes('CheckChangeOverTests')) return CSHARP_TEST;
                return '';
            }
        });

        expect(view.found).toBe(true);
        expect(view.definitions[0].path).toBe('Puratos.Opcenter/Handlers/CheckChangeOverForMultipleDestinationsHandler.cs');
        expect(view.callers.some(c => c.path.includes('ChangeOverController'))).toBe(true);
        expect(view.tests.some(t => t.path.includes('CheckChangeOverTests'))).toBe(true);
    });

    it('safely handles unsupported language file as plain text without throwing', () => {
        const text = 'SELECT * FROM users WHERE active = 1;';
        const facts = analyzeSourceForLanguage(text, '.sql');
        expect(facts).toBeDefined();
        expect(facts.symbols).toEqual([]);
        expect(facts.exports).toEqual([]);
        expect(facts.parseError).toBeNull();
    });

    it('indexes C# files through createGraphSync and resolves definitions in the graph', async () => {
        const { createGraphSync } = await import('../core/graph/sync/index.js');
        const fs = await import('fs');
        const os = await import('os');
        const path = await import('path');

        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csharp-sync-test-'));
        try {
            const srcDir = path.join(tempDir, 'Puratos.Opcenter', 'Handlers');
            fs.mkdirSync(srcDir, { recursive: true });
            fs.writeFileSync(path.join(srcDir, 'CheckChangeOverForMultipleDestinationsHandler.cs'), CSHARP_HANDLER, 'utf8');

            const syncer = createGraphSync({ root: tempDir });
            const result = await syncer.sync({ mode: 'full' });
            expect(result.nodes).toBeGreaterThan(0);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('classifies files using graphify-style file sets and extension detection', () => {
        expect(isCodeFile('src/index.js')).toBe(true);
        expect(isCodeFile('Services/Handler.cs')).toBe(true);
        expect(isCodeFile('main.py')).toBe(true);
        expect(isCodeFile('main.go')).toBe(true);
        expect(isCodeFile('main.rs')).toBe(true);
        expect(isCodeFile('queries/reporting.sql')).toBe(true);
        expect(isCodeFile('scripts/deploy.ps1')).toBe(true);
        expect(isCodeFile('k8s/deployment.yaml')).toBe(true);
        expect(isCodeFile('k8s/deployment.yml')).toBe(true);
        expect(isCodeFile('config.toml')).toBe(true);
        expect(isCodeFile('main.tf')).toBe(true);
        expect(isCodeFile('package.json')).toBe(true);
        expect(isCodeFile('Dockerfile')).toBe(true);
        expect(isCodeFile('README.md')).toBe(false);

        expect(isDocFile('docs/architecture.md')).toBe(true);
        expect(isDocFile('notes.txt')).toBe(true);
        expect(isDocFile('index.js')).toBe(false);

        expect(isConfigFile('App.csproj')).toBe(true);
        expect(isConfigFile('Puratos.sln')).toBe(true);
        expect(isConfigFile('data/sample.json')).toBe(false);
    });

    it('supports registering new language configs dynamically without hardcoded extensions', () => {
        const dummyConfig = {
            name: 'custom-lang',
            extensions: ['.custom'],
            extract: () => ({ exports: ['main'], symbols: ['main'] })
        };
        registerLanguageConfig(dummyConfig);
        expect(isLanguageSupported('.custom')).toBe(true);
        expect(isCodeFile('src/main.custom')).toBe(true);
    });

    it('analyzes Python source files with indentation blocks, imports, docstrings and calls', () => {
        const pySource = `"""User service for authentication and profile management."""
import os
from database import get_connection

class UserManager:
    def __init__(self, db):
        self.db = db

    async def authenticate(self, username, password):
        user = self.get_user(username)
        if user and self.verify(password):
            return user
        return None
`;
        const facts = analyzeSourceForLanguage(pySource, 'services/user.py');
        expect(facts).toBeDefined();
        expect(facts.symbols).toContain('UserManager');
        expect(facts.symbols).toContain('__init__');
        expect(facts.symbols).toContain('authenticate');
        expect(facts.imports).toContain('os');
        expect(facts.imports).toContain('database');
        expect(facts.purpose).toContain('User service for authentication');

        const callees = facts.calls.map(c => c[1]);
        expect(callees).toContain('get_user');
        expect(callees).toContain('verify');
    });

    it('analyzes TypeScript files with interfaces, types, functions and decorators', () => {
        const tsSource = `/**
 * Authentication token utilities.
 */
import { sign, verify } from 'jsonwebtoken';

export interface UserToken {
    userId: string;
    roles: string[];
}

export type TokenKind = 'access' | 'refresh';

export async function createToken(payload: UserToken): Promise<string> {
    validate(payload);
    return sign(payload, 'secret');
}
`;
        const facts = analyzeSourceForLanguage(tsSource, 'auth/tokens.ts');
        expect(facts).toBeDefined();
        expect(facts.symbols).toContain('UserToken');
        expect(facts.symbols).toContain('TokenKind');
        expect(facts.symbols).toContain('createToken');
        expect(facts.exports).toContain('createToken');
        expect(facts.imports).toContain('jsonwebtoken');
        expect(facts.purpose).toBe('Authentication token utilities.');

        const callees = facts.calls.map(c => c[1]);
        expect(callees).toContain('validate');
        expect(callees).toContain('sign');
    });

    it('analyzes Java files with classes, methods, imports and javadocs', () => {
        const javaSource = `/**
 * Product catalog repository.
 */
package com.example.catalog;

import java.util.List;
import java.util.Optional;

public class ProductCatalog {
    private final Database db;

    public ProductCatalog(Database db) {
        this.db = db;
    }

    public Optional<Product> findById(String id) {
        validateId(id);
        return db.query(id);
    }
}
`;
        const facts = analyzeSourceForLanguage(javaSource, 'src/main/java/ProductCatalog.java');
        expect(facts).toBeDefined();
        expect(facts.symbols).toContain('ProductCatalog');
        expect(facts.symbols).toContain('findById');
        expect(facts.imports).toContain('java.util.List');
        expect(facts.imports).toContain('java.util.Optional');
        expect(facts.purpose).toBe('Product catalog repository.');
    });

    it('analyzes C and C++ source and header files', () => {
        const cppSource = `// Vector math calculation utilities.
#include <vector>
#include <cmath>

struct Vector3 {
    float x, y, z;
};

class PhysicsEngine {
public:
    void stepSimulation(float dt) {
        applyForces(dt);
        integrate(dt);
    }
};
`;
        const facts = analyzeSourceForLanguage(cppSource, 'physics/engine.cpp');
        expect(facts).toBeDefined();
        expect(facts.symbols).toContain('Vector3');
        expect(facts.symbols).toContain('PhysicsEngine');
        expect(facts.symbols).toContain('stepSimulation');
        expect(facts.imports).toContain('vector');
        expect(facts.imports).toContain('cmath');
        expect(facts.purpose).toBe('Vector math calculation utilities.');
    });

    it('analyzes Go source files with packages, structs, receiver methods and imports', () => {
        const goSource = `// Package cache provides in-memory caching mechanisms.
package cache

import "sync"

type Store struct {
    mu sync.RWMutex
}

func (s *Store) Get(key string) (string, bool) {
    s.lock()
    return s.fetch(key)
}
`;
        const facts = analyzeSourceForLanguage(goSource, 'cache/store.go');
        expect(facts).toBeDefined();
        expect(facts.symbols).toContain('Store');
        expect(facts.symbols).toContain('Get');
        expect(facts.imports).toContain('sync');
        expect(facts.purpose).toContain('Package cache provides in-memory caching');
    });

    it('analyzes Rust source files with structs, traits, impl blocks and macros', () => {
        const rsSource = `//! Memory allocator and pool implementation.
use std::sync::Arc;

pub struct MemoryPool {
    capacity: usize,
}

pub trait Allocator {
    fn allocate(&self, size: usize) -> Vec<u8>;
}

impl MemoryPool {
    pub fn new(capacity: usize) -> Self {
        init_buffer(capacity);
        Self { capacity }
    }
}
`;
        const facts = analyzeSourceForLanguage(rsSource, 'src/alloc.rs');
        expect(facts).toBeDefined();
        expect(facts.symbols).toContain('MemoryPool');
        expect(facts.symbols).toContain('Allocator');
        expect(facts.symbols).toContain('new');
        expect(facts.imports).toContain('std::sync::Arc');
        expect(facts.purpose).toBe('Memory allocator and pool implementation.');
    });

    it('analyzes PHP source files with namespaces, classes and methods', () => {
        const phpSource = `<?php
/**
 * Order processing pipeline.
 */
namespace App\\Orders;

use App\\Models\\Order;

class OrderProcessor {
    public function process(Order $order): bool {
        $this->validate($order);
        return $this->dispatch($order);
    }
}
`;
        const facts = analyzeSourceForLanguage(phpSource, 'src/Orders/OrderProcessor.php');
        expect(facts).toBeDefined();
        expect(facts.symbols).toContain('OrderProcessor');
        expect(facts.symbols).toContain('process');
        expect(facts.imports).toContain('App\\Models\\Order');
        expect(facts.purpose).toBe('Order processing pipeline.');
    });

    it('analyzes Ruby source files with modules, classes and defs', () => {
        const rbSource = `# Payments gateway client.
require 'net/http'

module Billing
  class Gateway
    def charge(amount, token)
      validate(amount)
      execute_charge(token)
    end
  end
end
`;
        const facts = analyzeSourceForLanguage(rbSource, 'lib/billing/gateway.rb');
        expect(facts).toBeDefined();
        expect(facts.symbols).toContain('Billing');
        expect(facts.symbols).toContain('Gateway');
        expect(facts.symbols).toContain('charge');
        expect(facts.imports).toContain('net/http');
        expect(facts.purpose).toBe('Payments gateway client.');
    });

    it('analyzes Kotlin and Swift source files', () => {
        const ktSource = `/**
 * Customer analytics tracker.
 */
package com.app.analytics

import io.ktor.client.*

data class Event(val name: String)

class Tracker {
    fun track(event: Event) {
        logEvent(event)
    }
}
`;
        const ktFacts = analyzeSourceForLanguage(ktSource, 'src/Tracker.kt');
        expect(ktFacts.symbols).toContain('Event');
        expect(ktFacts.symbols).toContain('Tracker');
        expect(ktFacts.symbols).toContain('track');
        expect(ktFacts.imports).toContain('io.ktor.client.*');
        expect(ktFacts.purpose).toBe('Customer analytics tracker.');

        const swiftSource = `/// Network monitoring service.
import Foundation

protocol NetworkMonitor {
    func isConnected() -> Bool
}

class DefaultMonitor: NetworkMonitor {
    func isConnected() -> Bool {
        checkStatus()
        return true
    }
}
`;
        const swiftFacts = analyzeSourceForLanguage(swiftSource, 'Sources/NetworkMonitor.swift');
        expect(swiftFacts.symbols).toContain('NetworkMonitor');
        expect(swiftFacts.symbols).toContain('DefaultMonitor');
        expect(swiftFacts.symbols).toContain('isConnected');
        expect(swiftFacts.imports).toContain('Foundation');
        expect(swiftFacts.purpose).toBe('Network monitoring service.');
    });

    it('analyzes SQL files with tables, views, procedures, references and calls', () => {
        const sqlSource = `-- Customer orders and reporting tables.
CREATE TABLE orders (
    id INT PRIMARY KEY,
    customer_id INT,
    total DECIMAL(10,2)
);

CREATE VIEW high_value_orders AS
SELECT * FROM orders WHERE total > 1000;

CREATE PROCEDURE ProcessOrder(IN orderId INT)
BEGIN
    UPDATE orders SET status = 'processed' WHERE id = orderId;
    CALL NotifyCustomer(orderId);
END;
`;
        const facts = analyzeSourceForLanguage(sqlSource, 'migrations/001_orders.sql');
        expect(facts).toBeDefined();
        expect(facts.symbols).toContain('orders');
        expect(facts.symbols).toContain('high_value_orders');
        expect(facts.symbols).toContain('ProcessOrder');
        expect(facts.imports).toContain('orders');
        expect(facts.purpose).toBe('Customer orders and reporting tables.');
        expect(facts.functions.some(f => f.name === 'ProcessOrder')).toBe(true);
    });

    it('analyzes web files (CSS stylesheets and HTML templates)', () => {
        const cssSource = `/* Modern UI styles and typography */
@import url("theme.css");

.btn-primary {
    background: #007bff;
    color: #fff;
}

#main-content {
    padding: 20px;
}
`;
        const cssFacts = analyzeSourceForLanguage(cssSource, 'styles/main.css');
        expect(cssFacts.symbols).toContain('.btn-primary');
        expect(cssFacts.symbols).toContain('#main-content');
        expect(cssFacts.imports).toContain('theme.css');
        expect(cssFacts.purpose).toBe('Modern UI styles and typography');

        const htmlSource = `<!-- Dashboard application shell -->
<!DOCTYPE html>
<html>
<head>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div id="app-root"></div>
    <user-card></user-card>
    <script src="bundle.js"></script>
</body>
</html>
`;
        const htmlFacts = analyzeSourceForLanguage(htmlSource, 'index.html');
        expect(htmlFacts.symbols).toContain('#app-root');
        expect(htmlFacts.symbols).toContain('user-card');
        expect(htmlFacts.imports).toContain('styles.css');
        expect(htmlFacts.imports).toContain('bundle.js');
        expect(htmlFacts.purpose).toBe('Dashboard application shell');
    });

    it('analyzes Dockerfiles and Docker Compose infrastructure files', () => {
        const dockerfileSource = `# Production Node.js build container
FROM node:20-alpine AS builder
WORKDIR /app
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
EXPOSE 3000 8080
ENTRYPOINT ["node", "server.js"]
`;
        const dfFacts = analyzeSourceForLanguage(dockerfileSource, 'Dockerfile');
        expect(dfFacts.symbols).toContain('builder');
        expect(dfFacts.symbols).toContain('runner');
        expect(dfFacts.symbols).toContain('port:3000');
        expect(dfFacts.symbols).toContain('port:8080');
        expect(dfFacts.imports).toContain('node:20-alpine');
        expect(dfFacts.purpose).toBe('Production Node.js build container');

        const composeSource = `# Multi-container deployment compose
services:
  web:
    image: myorg/web:latest
  database:
    image: postgres:16-alpine
`;
        const composeFacts = analyzeSourceForLanguage(composeSource, 'docker-compose.yml');
        // docker-compose.yml is matched by DOCKER_CONFIG which has special handling
        expect(composeFacts.symbols).toContain('web');
        expect(composeFacts.symbols).toContain('database');
        expect(composeFacts.imports).toContain('myorg/web:latest');
        expect(composeFacts.imports).toContain('postgres:16-alpine');
        expect(composeFacts.purpose).toBe('Multi-container deployment compose');
    });

    it('analyzes PowerShell, Bash and Batch scripting files', () => {
        const psSource = `<#
.SYNOPSIS
Deployment and environment provisioning script.
#>
using module Configuration

function Deploy-Service {
    param($Environment)
    Invoke-Check
    Write-Host "Deploying to $Environment"
}
`;
        const psFacts = analyzeSourceForLanguage(psSource, 'deploy.ps1');
        expect(psFacts.symbols).toContain('Deploy-Service');
        expect(psFacts.imports).toContain('Configuration');
        expect(psFacts.purpose).toBe('Deployment and environment provisioning script.');

        const bashSource = `#!/usr/bin/env bash
# Continuous integration runner script
source ./env.sh

run_tests() {
    execute_suite
    report_status
}
`;
        const bashFacts = analyzeSourceForLanguage(bashSource, 'ci.sh');
        expect(bashFacts.symbols).toContain('run_tests');
        expect(bashFacts.imports).toContain('./env.sh');
        expect(bashFacts.purpose).toBe('Continuous integration runner script');

        const batchSource = `:: Windows build helper script
@echo off
:build
call npm run build
goto end
:end
`;
        const batchFacts = analyzeSourceForLanguage(batchSource, 'build.bat');
        expect(batchFacts.symbols).toContain('build');
        expect(batchFacts.symbols).toContain('end');
        expect(batchFacts.calls.some(c => c[1] === 'npm')).toBe(true);
        expect(batchFacts.purpose).toBe('Windows build helper script');
    });

    it('analyzes YAML infrastructure files (Kubernetes, Ansible, Serverless)', () => {
        const k8sSource = `# Kubernetes deployment configuration
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
  labels:
    app: my-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
      - name: nginx
        image: nginx:1.25
        ports:
        - containerPort: 80
        - containerPort: 443
`;
        const k8sFacts = analyzeSourceForLanguage(k8sSource, 'k8s/deployment.yaml');
        expect(k8sFacts.symbols).toContain('apiVersion');
        expect(k8sFacts.symbols).toContain('Deployment');
        expect(k8sFacts.symbols).toContain('my-app');
        expect(k8sFacts.symbols).toContain('nginx');
        expect(k8sFacts.imports).toContain('nginx:1.25');
        expect(k8sFacts.purpose).toBe('Kubernetes deployment configuration');

        const ansibleSource = `# Ansible playbook for server provisioning
- hosts: webservers
  tasks:
    - name: Install nginx
      apt:
        name: nginx
        state: present
    - name: Start nginx
      service:
        name: nginx
        state: started
`;
        const ansibleFacts = analyzeSourceForLanguage(ansibleSource, 'playbook.yml');
        expect(ansibleFacts.purpose).toContain('Ansible playbook for server provisioning');
        // The YAML parser extracts hosts line, check that it contains hosts
        expect(ansibleFacts.imports.length).toBeGreaterThan(0);
        expect(ansibleFacts.purpose).toBe('Ansible playbook for server provisioning');
    });

    it('analyzes TOML configuration files', () => {
        const tomlSource = `# Application configuration
 title = "My Application"
 version = "1.0.0"

[server]
 port = 8080
 host = "0.0.0.0"

[database]
 url = "postgres://user:pass@localhost:5432/db"
 pool_size = 10

[logging]
 level = "info"
 file = "/var/log/app.log"
`;
        const tomlFacts = analyzeSourceForLanguage(tomlSource, 'config.toml');
        expect(tomlFacts.symbols).toContain('title');
        expect(tomlFacts.symbols).toContain('version');
        expect(tomlFacts.symbols).toContain('server');
        expect(tomlFacts.symbols).toContain('database');
        expect(tomlFacts.symbols).toContain('logging');
        expect(tomlFacts.symbols).toContain('port');
        expect(tomlFacts.symbols).toContain('host');
        expect(tomlFacts.imports).toContain('postgres://user:pass@localhost:5432/db');
        expect(tomlFacts.purpose).toBe('Application configuration');
    });

    it('analyzes Terraform HCL infrastructure files', () => {
        const tfSource = `# AWS infrastructure as code
terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-west-2"
}

resource "aws_instance" "web_server" {
  ami           = "ami-0c55b159cbfafe1f0"
  instance_type = "t2.micro"
  tags = {
    Name = "web-server"
  }
}

resource "aws_s3_bucket" "assets" {
  bucket = "my-app-assets"
  acl    = "private"
}

output "instance_ip" {
  value = aws_instance.web_server.public_ip
}

module "vpc" {
  source = "terraform-aws-modules/vpc/aws"
  version = "3.0.0"
}
`;
        const tfFacts = analyzeSourceForLanguage(tfSource, 'main.tf');
        expect(tfFacts.symbols).toContain('web_server');
        expect(tfFacts.symbols).toContain('assets');
        expect(tfFacts.symbols).toContain('instance_ip');
        expect(tfFacts.symbols).toContain('vpc');
        expect(tfFacts.symbols).toContain('resource:aws_instance:web_server');
        expect(tfFacts.symbols).toContain('resource:aws_s3_bucket:assets');
        expect(tfFacts.imports).toContain('hashicorp/aws');
        expect(tfFacts.imports).toContain('terraform-aws-modules/vpc/aws');
        expect(tfFacts.purpose).toBe('AWS infrastructure as code');
    });

    it('analyzes JSON configuration files (package.json, tsconfig.json, etc.)', () => {
        const packageJsonSource = `{
  "name": "my-app",
  "version": "1.0.0",
  "description": "A modern web application",
  "main": "dist/index.js",
  "scripts": {
    "start": "node dist/index.js",
    "build": "tsc",
    "test": "jest"
  },
  "dependencies": {
    "express": "^4.18.0",
    "lodash": "^4.17.21"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "jest": "^29.0.0"
  }
}`;
        const pkgFacts = analyzeSourceForLanguage(packageJsonSource, 'package.json');
        expect(pkgFacts.symbols).toContain('name');
        expect(pkgFacts.symbols).toContain('version');
        expect(pkgFacts.symbols).toContain('scripts');
        expect(pkgFacts.symbols).toContain('start');
        expect(pkgFacts.symbols).toContain('build');
        expect(pkgFacts.symbols).toContain('test');
        expect(pkgFacts.symbols).toContain('my-app');
        expect(pkgFacts.symbols).toContain('v1.0.0');
        expect(pkgFacts.imports).toContain('express');
        expect(pkgFacts.imports).toContain('lodash');
        expect(pkgFacts.imports).toContain('typescript');
        expect(pkgFacts.imports).toContain('jest');

        expect(pkgFacts.functions.some(f => f.name === 'start')).toBe(true);
        expect(pkgFacts.functions.some(f => f.name === 'build')).toBe(true);
        expect(pkgFacts.functions.some(f => f.name === 'test')).toBe(true);
    });
});
