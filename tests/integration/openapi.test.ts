import test from "node:test";
import assert from "node:assert/strict";
import { Ajv2020 } from "ajv/dist/2020.js";
import { openapi } from "../../packages/contracts/src/openapi.ts";
test("versioned facade contract declares each path parameter and validates response schemas", () => {
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  for (const [path, item] of Object.entries(openapi.paths)) {
    const parameters = (item.parameters ?? []) as {
      name: string;
      in: string;
      required: boolean;
    }[];
    for (const match of path.matchAll(/\{([^}]+)\}/g))
      assert.ok(
        parameters.some(
          (p) => p.name === match[1] && p.in === "path" && p.required,
        ),
      );
    for (const verb of ["get", "post"])
      if (item[verb])
        for (const response of Object.values(item[verb].responses) as any[]) {
          const schema = response.content?.["application/json"]?.schema;
          if (schema)
            ajv.compile({ ...schema, components: openapi.components });
        }
  }
});
