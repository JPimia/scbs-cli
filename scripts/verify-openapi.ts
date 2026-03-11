import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { buildOpenApiJson, buildOpenApiYaml } from '../apps/server/src/openapi';

const rootDir = process.cwd();
const openApiDir = path.join(rootDir, 'openapi');

const jsonPath = path.join(openApiDir, 'scbs-v1.openapi.json');
const yamlPath = path.join(openApiDir, 'scbs-v1.openapi.yaml');

const [checkedInJson, checkedInYaml] = await Promise.all([
  readFile(jsonPath, 'utf8'),
  readFile(yamlPath, 'utf8'),
]);

const generatedJson = buildOpenApiJson();
const generatedYaml = buildOpenApiYaml();

if (JSON.stringify(JSON.parse(checkedInJson)) !== JSON.stringify(JSON.parse(generatedJson))) {
  console.error(`OpenAPI JSON artifact is out of date: ${jsonPath}`);
  process.exit(1);
}

if (checkedInYaml !== generatedYaml) {
  console.error(`OpenAPI YAML artifact is out of date: ${yamlPath}`);
  process.exit(1);
}

console.log('OpenAPI artifacts match the generated server contract.');
