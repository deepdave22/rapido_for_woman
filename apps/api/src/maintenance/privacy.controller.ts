import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Equals } from 'class-validator';
import { AuthUser, CurrentUser } from '../auth/auth.decorators';
import { PrivacyService } from './privacy.service';

class DeleteAccountDto {
  /** Must be exactly "DELETE" to confirm. */
  @Equals('DELETE')
  confirm: string;
}

@ApiTags('me')
@ApiBearerAuth()
@Controller({ path: 'me', version: '1' })
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  /** A copy of the personal data held about you. */
  @Get('export')
  export(@CurrentUser() user: AuthUser) {
    return this.privacy.export(user);
  }

  /** Deletes your account. Ride and payment records are kept anonymised as required by law. */
  @Post('delete')
  @HttpCode(200)
  delete(@CurrentUser() user: AuthUser, @Body() _dto: DeleteAccountDto) {
    return this.privacy.deleteAccount(user);
  }
}
