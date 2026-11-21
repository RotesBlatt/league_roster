import type { MemberDto, RosterEntryDto } from '@lol/api/schema-types'

/**
 * The captain's choices on the roster page, kept out of the component so they can be tested
 * without a DOM: who may be added, which accounts he may choose from, and what starts selected.
 *
 * The API stays authoritative about *ownership* of an account — this only fills the form, and a
 * wrong id is refused there with a 422.
 */

/** Members who are not on the roster yet: one entry per person per team. */
export function pickableMembers(members: MemberDto[], roster: RosterEntryDto[]): MemberDto[] {
  return members.filter((member) => !roster.some((entry) => entry.userId === member.id))
}

const label = (account: MemberDto['accounts'][number]) =>
  `${account.gameName}#${account.tagLine}${account.isMain ? ' · main' : ''}`

export function accountOptions(member: MemberDto | undefined): { value: string; label: string }[] {
  return (member?.accounts ?? []).map((account) => ({
    value: account.id,
    label: label(account),
  }))
}

/** His main account starts selected; a member with no accounts preselects nothing. */
export function defaultAccountId(member: MemberDto | undefined): string | null {
  return member?.accounts.find((account) => account.isMain)?.id ?? null
}
