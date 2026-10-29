import { useEffect, useState } from 'react';
import { organizationService } from '../services/api';
import { fetchAllOrganizations } from './useOrganizations';

/**
 * #1354: which organization a create form should ask for.
 *
 * The backend stamps a created record's organization with
 * resolveOrganizationIdForCreate: a single-organization caller gets their
 * own, a multi-organization caller must name one of theirs (400 otherwise),
 * and a global caller may name any or none. So a form asks only when the
 * caller has a choice:
 *
 * - `organization` scope with two or more organizations: a required pick
 *   among them.
 * - `global` scope: an optional pick among every organization.
 * - anything else (one organization, none, still loading, a failed lookup):
 *   no picker, and the backend decides.
 */
export type CreateOrganizationOption = { organizationId: string; officialName: string | null };

export type CreateOrganizationChoice = {
  show: boolean;
  required: boolean;
  options: CreateOrganizationOption[];
};

const HIDDEN: CreateOrganizationChoice = { show: false, required: false, options: [] };

export async function loadCreateOrganizationChoice(): Promise<CreateOrganizationChoice> {
  const response = await organizationService.getMine();
  const data = response.data?.data;
  if (data?.scope === 'organization' && (data.organizations?.length || 0) > 1) {
    return { show: true, required: true, options: data.organizations };
  }
  if (data?.scope === 'global') {
    const all = await fetchAllOrganizations();
    const options = all
      .map((org) => {
        const record = org as unknown as Record<string, unknown>;
        return {
          organizationId: String(record.organizationId ?? ''),
          officialName: (record.officialName as string | undefined) ?? null,
        };
      })
      .filter((option) => option.organizationId);
    return { show: options.length > 0, required: false, options };
  }
  return HIDDEN;
}

export function useCreateOrganizationChoice(): CreateOrganizationChoice {
  const [choice, setChoice] = useState<CreateOrganizationChoice>(HIDDEN);

  useEffect(() => {
    let active = true;
    loadCreateOrganizationChoice()
      .then((next) => {
        if (active) setChoice(next);
      })
      .catch(() => {
        // The backend still refuses a create it cannot place, with a message
        // the form shows, so a failed lookup degrades to no picker.
        if (active) setChoice(HIDDEN);
      });
    return () => {
      active = false;
    };
  }, []);

  return choice;
}
