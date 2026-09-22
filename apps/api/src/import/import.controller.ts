import { ImportSummary } from '@household-budget/core';
import {
  BadRequestException,
  Body,
  Controller,
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

/** Sparkasse's own export dialog serves a .csv as application/vnd.ms-excel. */
const ACCEPTED_TYPES = new Set(['text/csv', 'application/vnd.ms-excel']);

@Controller('imports')
export class ImportController {
  constructor(private readonly imports: ImportService) {}

  /** POST /api/imports — multipart: `file` plus an `accountId` field. */
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
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
      throw new BadRequestException(`unsupported content type ${file.mimetype}`);
    }

    return this.imports.importCsv({
      accountId,
      fileName: file.originalname,
      // Bytes, not a string: which encoding they are is decode.ts's decision.
      bytes: new Uint8Array(file.buffer),
    });
  }
}
