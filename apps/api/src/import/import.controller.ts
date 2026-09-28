import { ImportBatchPayload, ImportSummary } from '@household-budget/core';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { ImportService } from './import.service.js';

/**
 * What multer hands back. Typed locally because `@types/multer` is not installed and
 * `apps/api/tsconfig.json` pins `types: ["node"]`, so the global `Express.Multer.File`
 * does not exist here.
 */
interface UploadedCsv {
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
  readonly buffer: Buffer;
}

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * The form is one file plus one `accountId` field (a ~25-char id). Nest turns every
 * overrun but `fileSize` into a 400; `fileSize` stays a 413.
 */
const UPLOAD_LIMITS = {
  fileSize: MAX_BYTES,
  files: 1,
  // `accountId` plus headroom; anything past this is not our form.
  fields: 5,
  // Bytes per field value — an id, not a document.
  fieldSize: 1024,
  // files + fields.
  parts: 6,
  fieldNameSize: 100,
};

/**
 * What a browser labels a CSV varies: Sparkasse's own export dialog serves it as
 * application/vnd.ms-excel, and depending on OS and file associations a picked .csv
 * arrives as text/plain, application/octet-stream or untyped. The parser's
 * HEADER_NOT_FOUND is the real gate; this list only turns away obvious non-text types.
 */
const ACCEPTED_TYPES = new Set([
  'text/csv',
  'application/vnd.ms-excel',
  'text/plain',
  'application/octet-stream',
  '',
]);

@Controller('imports')
export class ImportController {
  constructor(private readonly imports: ImportService) {}

  /** GET /api/imports — every upload, newest first. */
  @Get()
  list(): Promise<ImportBatchPayload[]> {
    return this.imports.listBatches();
  }

  /**
   * DELETE /api/imports/:id — removes an upload's rows, keeps the upload listed as removed.
   * 200 with the batch as it now stands, which is what the undo snackbar shows.
   */
  @Delete(':id')
  @HttpCode(200)
  undo(@Param('id') id: string): Promise<ImportBatchPayload> {
    return this.imports.undo(id);
  }

  /** POST /api/imports/:id/restore — the undo for `DELETE`: the same rows come back. */
  @Post(':id/restore')
  restore(@Param('id') id: string): Promise<ImportBatchPayload> {
    return this.imports.restore(id);
  }

  /** POST /api/imports — multipart: `file` plus an `accountId` field. */
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: UPLOAD_LIMITS }))
  upload(
    @UploadedFile() file: UploadedCsv | undefined,
    @Body('accountId') accountId: unknown,
  ): Promise<ImportSummary> {
    if (typeof accountId !== 'string' || accountId.trim() === '') {
      throw new BadRequestException('accountId is required');
    }
    if (file === undefined) {
      throw new BadRequestException('file is required');
    }
    if (file.size > MAX_BYTES) {
      throw new BadRequestException(`file is larger than ${String(MAX_BYTES)} bytes`);
    }
    if (!ACCEPTED_TYPES.has(file.mimetype)) {
      throw new BadRequestException({ code: 'UNSUPPORTED_CONTENT_TYPE' });
    }

    return this.imports.importCsv({
      accountId,
      fileName: file.originalname,
      // Bytes, not a string: which encoding they are is decode.ts's decision.
      bytes: new Uint8Array(file.buffer),
    });
  }
}
