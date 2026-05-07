const textEncoder = new TextEncoder();

async function sha256Hex(input) {
  const payload = typeof input === 'string' ? input : String(input ?? '');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', textEncoder.encode(payload));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function stableStringify(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function normalizeIntegrityInput(data = {}) {
  const clinicalSource = data.clinical_data && typeof data.clinical_data === 'object' ? data.clinical_data : null;
  const sprecSource = data.sprec && typeof data.sprec === 'object' ? data.sprec : null;
  const rcsSource = data.rcs_evaluation && typeof data.rcs_evaluation === 'object'
    ? data.rcs_evaluation
    : (sprecSource?.rcs_evaluation && typeof sprecSource.rcs_evaluation === 'object' ? sprecSource.rcs_evaluation : null);
  const axisPenalties = Array.isArray(data.axis_penalties)
    ? data.axis_penalties
    : (Array.isArray(sprecSource?.axis_penalties) ? sprecSource.axis_penalties : []);

  const charlsonConditions = Array.isArray(data.charlson_conditions)
    ? data.charlson_conditions.map((item) => String(item || '').trim()).filter(Boolean).sort((left, right) => left.localeCompare(right))
    : [];

  const diseasePhenotypes = Array.isArray(data.disease_phenotypes)
    ? data.disease_phenotypes.map((item) => ({
      hpoId: String(item?.hpoId || item?.code || '').trim(),
      label: String(item?.label || item?.display || '').trim(),
    })).filter((item) => item.hpoId || item.label).sort((left, right) => `${left.hpoId}:${left.label}`.localeCompare(`${right.hpoId}:${right.label}`))
    : [];

  const diseaseBiomarkers = Array.isArray(data.disease_biomarkers)
    ? data.disease_biomarkers.map((item) => ({
      code: String(item?.code || item?.biomarkerType || '').trim(),
      label: String(item?.label || item?.display || '').trim(),
      unit: String(item?.unit || '').trim(),
      value: String(item?.value ?? '').trim(),
    })).filter((item) => item.code || item.label || item.value).sort((left, right) => `${left.code}:${left.label}:${left.value}`.localeCompare(`${right.code}:${right.label}:${right.value}`))
    : [];

  return {
    patient_identity: {
      patient_id: String(data.patient_identity?.patient_id || data.patientID || data.patientId || '').trim(),
      patient_name: String(data.patient_identity?.patient_name || data.patient_name || '').trim(),
    },
    clinical_data: clinicalSource
      ? {
        orphaCode: String(clinicalSource.orphaCode || '').trim(),
        omimCode: String(clinicalSource.omimCode || '').trim(),
        cid: String(clinicalSource.cid || '').trim(),
        phenotypes: Array.isArray(clinicalSource.phenotypes) ? clinicalSource.phenotypes : diseasePhenotypes,
        charlsonComorbidities: Array.isArray(clinicalSource.charlsonComorbidities) ? clinicalSource.charlsonComorbidities : charlsonConditions,
        biomarkers_values: clinicalSource.biomarkers_values && typeof clinicalSource.biomarkers_values === 'object' ? clinicalSource.biomarkers_values : {},
      }
      : {
        patient_name: String(data.patient_name || '').trim(),
        birth_date: String(data.birth_date || '').trim(),
        gender: String(data.gender || '').trim(),
        diagnosis_cid_code: String(data.diagnosis_cid_code || '').trim(),
        diagnosis_orpha_code: String(data.diagnosis_orpha_code || '').trim(),
        diagnosis_omim_code: String(data.diagnosis_omim_code || '').trim(),
        diagnosis_definition: String(data.diagnosis_definition || '').trim(),
        sample_type: String(data.sample_type || '').trim(),
        sample_origin: String(data.sample_origin || '').trim(),
        extraction_protocol: String(data.extraction_protocol || '').trim(),
        collection_institution: String(data.collection_institution || '').trim(),
        collection_institution_acronym: String(data.collection_institution_acronym || '').trim(),
        linked_project: String(data.linked_project || '').trim(),
        quantity: String(data.quantity || '').trim(),
        pre_analytical_unknown: Boolean(data.pre_analytical_unknown),
        collection_datetime: String(data.collection_datetime || '').trim(),
        processing_datetime: String(data.processing_datetime || '').trim(),
        transport_temperature: String(data.transport_temperature || '').trim(),
        ischemia_time_minutes: String(data.ischemia_time_minutes || '').trim(),
        selected_tcle: String(data.selected_tcle || '').trim(),
        sprec_code: String(data.sprec_code || '').trim(),
        rcs_evaluation: rcsSource
          ? {
            model_version: String(rcsSource.model_version || 'RCS-GOV-1.0'),
            matrix_type: String(rcsSource.matrix_type || '').trim(),
            governance_status: rcsSource.governance_status ?? null,
            governance_failure_reasons: Array.isArray(rcsSource.governance_failure_reasons) ? rcsSource.governance_failure_reasons : [],
            p_bio: rcsSource.p_bio ?? null,
            rcs_score: rcsSource.rcs_score ?? null,
            score_based_grade: rcsSource.score_based_grade || null,
            final_grade: String(rcsSource.final_grade || '').trim(),
            grade_route: String(rcsSource.grade_route || '').trim(),
            axis_penalties: Array.isArray(rcsSource.axis_penalties) ? rcsSource.axis_penalties : axisPenalties,
            calculation_trace: rcsSource.calculation_trace && typeof rcsSource.calculation_trace === 'object' ? rcsSource.calculation_trace : {},
          }
          : null,
        charlson_conditions: charlsonConditions,
        charlson_score: String(data.charlson_score || '').trim(),
        disease_phenotypes: diseasePhenotypes,
        disease_biomarkers: diseaseBiomarkers,
        biomarkers_values: data.biomarkers_values && typeof data.biomarkers_values === 'object' ? data.biomarkers_values : {},
      },
    sprec: sprecSource
      ? {
        matrixType: String(sprecSource.matrixType || '').trim(),
        sampleType: String(sprecSource.sampleType || '').trim(),
        primaryContainer: String(sprecSource.primaryContainer || '').trim(),
        preCentrifugation: String(sprecSource.preCentrifugation || '').trim(),
        centrifugation: String(sprecSource.centrifugation || '').trim(),
        secondCentrifugation: String(sprecSource.secondCentrifugation || '').trim(),
        postCentrifugationDelay: String(sprecSource.postCentrifugationDelay || '').trim(),
        longTermStorage: String(sprecSource.longTermStorage || '').trim(),
        rcs_evaluation: rcsSource,
      }
      : {},
    pharmacology_data: data.pharmacology_data && typeof data.pharmacology_data === 'object'
      ? {
        treatment_status: String(data.pharmacology_data.treatment_status || '').trim(),
        drug_name: String(data.pharmacology_data.drug_name || data.pharmacology_data.medication_name || '').trim(),
        atc_code: String(data.pharmacology_data.atc_code || data.pharmacology_data.medication_code || '').trim().replace(/^ATC:/i, '').toUpperCase(),
        atc_level_1: String(data.pharmacology_data.atc_level_1 || data.pharmacology_data.medication_drug_class || '').trim().toUpperCase(),
        // Legacy aliases preserved in canonical payload for compatibility.
        medication_name: String(data.pharmacology_data.medication_name || data.pharmacology_data.drug_name || '').trim(),
        medication_code: String(data.pharmacology_data.medication_code || data.pharmacology_data.atc_code || '').trim().replace(/^ATC:/i, '').toUpperCase(),
        medication_drug_class: String(data.pharmacology_data.medication_drug_class || data.pharmacology_data.atc_level_1 || '').trim().toUpperCase(),
        last_dose_date: String(data.pharmacology_data.last_dose_date || '').trim(),
        washout_start_date: String(data.pharmacology_data.washout_start_date || '').trim(),
        washout_end_date: String(data.pharmacology_data.washout_end_date || '').trim(),
      }
      : {
        treatment_status: '',
        drug_name: '',
        atc_code: '',
        atc_level_1: '',
        medication_name: '',
        medication_code: '',
        medication_drug_class: '',
        last_dose_date: '',
        washout_start_date: '',
        washout_end_date: '',
      },
  };
}

function buildLeafEntries(normalizedData) {
  return [
    ['patient_identity', normalizedData.patient_identity],
    ['clinical_data', normalizedData.clinical_data],
    ['pharmacology_data', normalizedData.pharmacology_data],
  ];
}

async function buildSampleMerkleRoot(data = {}) {
  const normalizedData = normalizeIntegrityInput(data);
  const leafEntries = buildLeafEntries(normalizedData);

  const leafHashes = [];
  for (const [key, value] of leafEntries) {
    const deterministicLeaf = `${key}:${stableStringify(value)}`;
    leafHashes.push(await sha256Hex(deterministicLeaf));
  }

  if (leafHashes.length === 0) {
    return {
      rootHash: null,
      leafHashes: [],
      leafEntries,
    };
  }

  let currentLayer = [...leafHashes];
  while (currentLayer.length > 1) {
    const nextLayer = [];
    for (let index = 0; index < currentLayer.length; index += 2) {
      const left = currentLayer[index];
      const right = currentLayer[index + 1] || currentLayer[index];
      nextLayer.push(await sha256Hex(`${left}${right}`));
    }
    currentLayer = nextLayer;
  }

  return {
    rootHash: currentLayer[0],
    leafHashes,
    leafEntries,
  };
}

async function verifySampleIntegrity(data, rootHash) {
  if (!rootHash) return false;
  const result = await buildSampleMerkleRoot(data);
  return result.rootHash === rootHash;
}

export {
  buildSampleMerkleRoot,
  verifySampleIntegrity,
  normalizeIntegrityInput,
};
