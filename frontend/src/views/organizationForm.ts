import { Organization } from '../types/models';

/**
 * (organizationId, normalizedName, _id) e normaliza campos opcionais
 * vazios para null (o backend distingue "não informado" de string vazia).
 */
export function buildOrganizationSubmissionPayload(
  formData: Partial<Organization>
): Partial<Organization> {
  const { organizationId, normalizedName, _id, ...rest } = formData;
  return {
    ...rest,
    acronym: rest.acronym ? rest.acronym : null,
    organizationType: rest.organizationType ? rest.organizationType : null,
    website: rest.website ? rest.website : null,
  };
}
