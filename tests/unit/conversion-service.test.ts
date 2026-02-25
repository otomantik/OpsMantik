/**
 * Sprint 1.5 — Unit tests for determineGoogleAction()
 *
 * Uses Node's built-in test runner (no extra dependencies).
 * Run with: npx tsx --test tests/unit/conversion-service.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import { determineGoogleAction } from "@/lib/services/conversion-service";

// ---------------------------------------------------------------------------
// Core decision table tests
// ---------------------------------------------------------------------------

test("should RETRACT when star = 1 (any revenue)", () => {
    const result = determineGoogleAction(1, 5000, 2000);
    assert.equal(result.action, "RETRACT");
    assert.equal(result.adjustment_value, 0);
});

test("should RETRACT when star = 2 (any revenue)", () => {
    const result = determineGoogleAction(2, 5000, 2000);
    assert.equal(result.action, "RETRACT");
    assert.equal(result.adjustment_value, 0);
});

test("should SEND revenue when star = 5 and revenue > 0", () => {
    const result = determineGoogleAction(5, 5000, 2000);
    assert.equal(result.action, "SEND");
    assert.equal(result.adjustment_value, 5000);
});

test("should RESTATE presignal when star = 5 and revenue = 0", () => {
    const result = determineGoogleAction(5, 0, 2200);
    assert.equal(result.action, "RESTATE");
    assert.equal(result.adjustment_value, 2200);
});

// ---------------------------------------------------------------------------
// Mid-tier (3–4 stars) tests
// ---------------------------------------------------------------------------

test("should SEND revenue when star = 4 and revenue > 0", () => {
    const result = determineGoogleAction(4, 3000, 1500);
    assert.equal(result.action, "SEND");
    assert.equal(result.adjustment_value, 3000);
});

test("should SEND presignal when star = 4 and revenue = 0", () => {
    const result = determineGoogleAction(4, 0, 1500);
    assert.equal(result.action, "SEND");
    assert.equal(result.adjustment_value, 1500);
});

test("should SEND revenue when star = 3 and revenue > 0", () => {
    const result = determineGoogleAction(3, 1000, 800);
    assert.equal(result.action, "SEND");
    assert.equal(result.adjustment_value, 1000);
});

test("should SEND presignal when star = 3 and revenue = 0", () => {
    const result = determineGoogleAction(3, 0, 800);
    assert.equal(result.action, "SEND");
    assert.equal(result.adjustment_value, 800);
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test("should RETRACT when star = 2 and revenue = 0", () => {
    const result = determineGoogleAction(2, 0, 0);
    assert.equal(result.action, "RETRACT");
    assert.equal(result.adjustment_value, 0);
});

test("should RESTATE with presignal=0 when star = 5 and all values zero", () => {
    const result = determineGoogleAction(5, 0, 0);
    assert.equal(result.action, "RESTATE");
    assert.equal(result.adjustment_value, 0);
});
