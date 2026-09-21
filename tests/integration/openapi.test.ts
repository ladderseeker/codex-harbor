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

test("turn and recovery request contracts support files while rejecting empty input", () => {
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  const paths = openapi.paths as Record<string, any>;
  const schemas = [
    openapi.components.schemas.TurnInput,
    paths["/sessions/{id}/turns"].post.requestBody.content["application/json"]
      .schema,
    paths["/sessions/{id}/recovery/continue"].post.requestBody.content[
      "application/json"
    ].schema,
  ];
  const id = "11111111-1111-4111-8111-111111111111";
  for (const [index, schema] of schemas.entries()) {
    const validate = ajv.compile(schema);
    const input = {
      text: "",
      model: "fixture",
      effort: "medium",
      permissionProfile: "workspace-write",
      ...(index === 2
        ? {
            recoveryId: id,
            expectedGeneration: 1,
            acknowledgeUnknownEffects: true,
          }
        : {}),
    };
    assert.equal(validate(input), false);
    assert.equal(validate({ ...input, text: "   " }), false);
    assert.equal(validate({ ...input, text: "Continue" }), true);
    assert.equal(validate({ ...input, attachmentIds: [id] }), true);
    assert.equal(
      validate({ ...input, attachmentIds: Array(5).fill(id) }),
      false,
    );
    if (index === 2)
      assert.equal(
        validate({
          ...input,
          attachmentIds: [id],
          acknowledgeUnknownEffects: false,
        }),
        false,
      );
  }
});
