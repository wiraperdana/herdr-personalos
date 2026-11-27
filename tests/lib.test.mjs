import { test } from "node:test";
import assert from "node:assert/strict";
import * as lib from "../mods/personalos-viewer/lib.js";

test("lib loads", () => { assert.equal(lib.LIB_OK, true); });
