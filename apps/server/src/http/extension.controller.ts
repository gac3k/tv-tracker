import { Controller, Get } from "@nestjs/common";
import { extensionToken } from "../extension-token";

@Controller("extension")
export class ExtensionController {
  @Get()
  info() {
    return { token: extensionToken() };
  }
}
