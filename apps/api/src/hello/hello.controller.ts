import { HelloPayload } from '@household-budget/core';
import { Controller, Get } from '@nestjs/common';

import { HelloService } from './hello.service.js';

@Controller('hello')
export class HelloController {
  constructor(private readonly helloService: HelloService) {}

  /** GET /api/hello */
  @Get()
  getHello(): Promise<HelloPayload> {
    return this.helloService.getHello();
  }
}
