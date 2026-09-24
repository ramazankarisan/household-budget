import { type ImportSummary } from '@household-budget/core';
import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ImportController } from './import.controller.js';
import { type ImportService } from './import.service.js';

const summary = { imported: 1 } as unknown as ImportSummary;

let importCsv: ReturnType<typeof vi.fn>;
let controller: ImportController;

beforeEach(() => {
  importCsv = vi.fn(() => Promise.resolve(summary));
  controller = new ImportController({ importCsv } as unknown as ImportService);
});

function file(mimetype: string) {
  return {
    originalname: 'export.csv',
    mimetype,
    size: 3,
    buffer: Buffer.from('a;b'),
  };
}

function rejection(run: () => unknown): BadRequestException {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return error as BadRequestException;
  }
  throw new Error('expected a BadRequestException');
}

describe('ImportController.upload', () => {
  it.each(['text/csv', 'application/vnd.ms-excel', 'text/plain', 'application/octet-stream', ''])(
    'passes a file typed %j to the import',
    async (mimetype) => {
      await expect(controller.upload(file(mimetype), 'acc-1')).resolves.toBe(summary);

      expect(importCsv).toHaveBeenCalledWith({
        accountId: 'acc-1',
        fileName: 'export.csv',
        bytes: new Uint8Array(Buffer.from('a;b')),
      });
    },
  );

  it.each(['image/png', 'application/pdf'])('rejects %s with a coded 400', (mimetype) => {
    const error = rejection(() => controller.upload(file(mimetype), 'acc-1'));

    expect(error.getResponse()).toEqual({ code: 'UNSUPPORTED_CONTENT_TYPE' });
    expect(importCsv).not.toHaveBeenCalled();
  });

  it('still requires a file', () => {
    const error = rejection(() => controller.upload(undefined, 'acc-1'));

    expect(error.message).toBe('file is required');
  });

  it('still requires an accountId', () => {
    const error = rejection(() => controller.upload(file('text/csv'), '  '));

    expect(error.message).toBe('accountId is required');
  });
});
