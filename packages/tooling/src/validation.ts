import { readFile } from "node:fs/promises";
import path from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { frameworkRoot } from "./catalog.js";

export type ValidationResult = {
  valid: boolean;
  errors: string[];
};

export async function validateDashboard(
  manifest: unknown,
  root?: string,
): Promise<ValidationResult> {
  const schemaRaw = await readFile(
    path.join(frameworkRoot(root), "schemas", "dashboard-manifest.schema.json"),
    "utf8",
  );
  const schema = JSON.parse(schemaRaw);
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  const validate = ajv.compile(schema);
  const valid = validate(manifest);

  return {
    valid: Boolean(valid),
    errors: (validate.errors ?? []).map((error) =>
      `${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
    ),
  };
}

export async function validateDashboardFile(
  filePath: string,
  root?: string,
): Promise<ValidationResult> {
  const raw = await readFile(path.resolve(filePath), "utf8");
  return validateDashboard(JSON.parse(raw), root);
}
