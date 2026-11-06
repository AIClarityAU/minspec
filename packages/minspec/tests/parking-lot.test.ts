import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  appendToParkingLotFile,
  createParkingLotEntry,
  type ParkingLotEntry,
} from '../src/lib/parking-lot';
import { NotOptedInError } from '../src/lib/opt-in';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('parking-lot', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-parking-test-'));
    // SPEC-096: the local parking lot lives in `.minspec/`, so it exists only in a
    // folder that has opted in. The store used to create that directory itself.
    fs.mkdirSync(path.join(tmpDir, '.minspec'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('createParkingLotEntry()', () => {
    it('creates entry with defaults', () => {
      const entry = createParkingLotEntry('My topic', 'Details here', 'Current scope');
      expect(entry.title).toBe('My topic');
      expect(entry.body).toBe('Details here');
      expect(entry.sessionScope).toBe('Current scope');
      expect(entry.labels).toEqual(['idea', 'inbox']);
      expect(entry.createdAt).toBeTruthy();
      expect(() => new Date(entry.createdAt)).not.toThrow();
    });

    it('accepts custom labels', () => {
      const entry = createParkingLotEntry('Topic', 'Body', 'Scope', ['bug', 'P1']);
      expect(entry.labels).toEqual(['bug', 'P1']);
    });
  });

  describe('appendToParkingLotFile()', () => {
    it('creates parking-lot.md with header when file does not exist', () => {
      const entry = createParkingLotEntry(
        'Consider caching',
        'Spec lookups could be cached',
        'Implement auth (minspec, feat)',
      );

      const filePath = appendToParkingLotFile(tmpDir, entry);
      expect(filePath).toBe(path.join(tmpDir, '.minspec', 'parking-lot.md'));
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('# Parking Lot');
      expect(content).toContain('## Consider caching');
      expect(content).toContain('Spec lookups could be cached');
      expect(content).toContain('Implement auth (minspec, feat)');
      expect(content).toContain('idea, inbox');
    });

    it('appends to existing parking-lot.md without duplicating header', () => {
      const entry1 = createParkingLotEntry('First topic', 'First body', 'Scope 1');
      const entry2 = createParkingLotEntry('Second topic', 'Second body', 'Scope 2');

      appendToParkingLotFile(tmpDir, entry1);
      appendToParkingLotFile(tmpDir, entry2);

      const filePath = path.join(tmpDir, '.minspec', 'parking-lot.md');
      const content = fs.readFileSync(filePath, 'utf-8');

      // Only one header
      const headerCount = (content.match(/# Parking Lot/g) || []).length;
      expect(headerCount).toBe(1);

      // Both entries present
      expect(content).toContain('## First topic');
      expect(content).toContain('## Second topic');
      expect(content).toContain('First body');
      expect(content).toContain('Second body');
    });

    it('refuses in a folder with no .minspec dir, and does not create it (SPEC-096 FR-5)', () => {
      // This test used to assert the opposite: that the store creates `.minspec/`.
      // That directory is the opt-in marker, so creating it here was the defect
      // (#2364). The fuller version of this case, for every store, is in
      // opt-in-writer-inventory.test.ts.
      const bareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-bare-parking-'));
      const entry = createParkingLotEntry('Topic', 'Body', 'Scope');

      expect(() => appendToParkingLotFile(bareDir, entry)).toThrow(NotOptedInError);

      expect(fs.existsSync(path.join(bareDir, '.minspec'))).toBe(false);
      fs.rmSync(bareDir, { recursive: true, force: true });
    });

    it('includes all metadata in entry block', () => {
      const entry: ParkingLotEntry = {
        title: 'My Topic',
        body: 'The details',
        labels: ['bug', 'P1'],
        sessionScope: 'Fix auth flow (minspec, bug)',
        createdAt: '2026-05-26T10:00:00.000Z',
      };

      appendToParkingLotFile(tmpDir, entry);

      const filePath = path.join(tmpDir, '.minspec', 'parking-lot.md');
      const content = fs.readFileSync(filePath, 'utf-8');

      expect(content).toContain('## My Topic');
      expect(content).toContain('**Date:** 2026-05-26T10:00:00.000Z');
      expect(content).toContain('**Session scope:** Fix auth flow (minspec, bug)');
      expect(content).toContain('**Labels:** bug, P1');
      expect(content).toContain('The details');
    });

    it('handles empty labels', () => {
      const entry: ParkingLotEntry = {
        title: 'No Labels',
        body: 'Body',
        labels: [],
        sessionScope: 'Scope',
        createdAt: '2026-01-01T00:00:00Z',
      };

      appendToParkingLotFile(tmpDir, entry);

      const content = fs.readFileSync(
        path.join(tmpDir, '.minspec', 'parking-lot.md'),
        'utf-8',
      );
      expect(content).toContain('**Labels:** none');
    });
  });
});
