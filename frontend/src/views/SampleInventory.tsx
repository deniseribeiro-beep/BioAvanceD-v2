import React, { useMemo, useState } from 'react';
import PrintQueueDashboard from '../components/PrintQueueDashboard';
import { SampleLabelData } from '../types/labels';
import { Tabs, Tab } from '@radix-ui/react-tabs';
import { DataGrid } from '@mui/x-data-grid';
import { Box, TextField, MenuItem } from '@mui/material';
import { useSamplesInventory } from '../hooks/samples/useSamplesInventory';
import FreezerMapView from '../components/samples/StorageHierarchy';
import { ShieldCheck, ShieldX } from 'lucide-react';

function getRcsEvaluation(row: any) {
  return row?.rcs_evaluation && typeof row.rcs_evaluation === 'object' ? row.rcs_evaluation : row;
}

function getRcsFinalGrade(row: any) {
  const rcs = getRcsEvaluation(row);
  return String(rcs?.final_grade || '').toUpperCase();
}

function getRcsScore(row: any) {
  const rcs = getRcsEvaluation(row);
  return rcs?.rcs_score ?? null;
}

function getRcsQualityLabel(row: any) {
  const rcs = getRcsEvaluation(row);
  const grade = getRcsFinalGrade(row) || '-';
  const score = getRcsScore(row) ?? '-';
  const route = String(rcs?.grade_route || '').trim();
  const reasons = Array.isArray(rcs?.governance_failure_reasons)
    ? rcs.governance_failure_reasons.map((reason: any) => String(reason || '').trim()).filter(Boolean)
    : [];

  if (rcs?.governance_status === 0) {
    const failureDetail = reasons.length ? `: ${reasons.join('; ')}` : '';
    return `Grade ${grade} | RCS ${score} | ${route || 'Governance failure'}${failureDetail}`;
  }

  return `Grade ${grade} | RCS ${score}${route ? ` | ${route}` : ''}`;
}

export const SampleInventory: React.FC = () => {
  const { printQueue, quarantined, available, allSamples, loading, error } = useSamplesInventory();
  const [tab, setTab] = useState('print');
  const [orphaFilter, setOrphaFilter] = useState('');
  const [qualityCategoryFilter, setQualityCategoryFilter] = useState('');

  const filteredRows = useMemo(() => {
    const sourceRows = tab === 'quarantine' ? quarantined : tab === 'available' ? available : allSamples;
    return sourceRows.filter((row: any) => {
      const orpha = String(row?.clinical_data?.orphaCode || '').toLowerCase();
      const finalGrade = getRcsFinalGrade(row);

      if (orphaFilter && !orpha.includes(orphaFilter.toLowerCase())) {
        return false;
      }
      if (qualityCategoryFilter && finalGrade !== qualityCategoryFilter.toUpperCase()) {
        return false;
      }
      return true;
    });
  }, [tab, quarantined, available, allSamples, orphaFilter, qualityCategoryFilter]);

  const printSamples = useMemo(() => {
    return (printQueue || []).map((item: any) => ({
      sampleId: String(item.sampleID || item._id || ''),
      equipmentId: String(item.locationID || ''),
      boxId: String(item.locationID || ''),
      coordinate: String(item.locationID || ''),
      equipmentLabel: String(item.sampleType || ''),
      boxLabel: String(item.release_status || ''),
    })) as SampleLabelData[];
  }, [printQueue]);

  const columns = [
    { field: 'sampleID', headerName: 'ID', width: 170, valueGetter: (params: any) => params.row.sampleID || params.row._id || '-' },
    {
      field: 'quality',
      headerName: 'Qualidade',
      width: 220,
      valueGetter: (params: any) => getRcsQualityLabel(params.row)
    },
    {
      field: 'integrity',
      headerName: 'Integridade',
      width: 140,
      renderCell: (params: any) => {
        const ok = Boolean(params.row.integrityOk);
        return ok ? <ShieldCheck size={18} color="#16a34a" /> : <ShieldX size={18} color="#dc2626" />;
      }
    },
    {
      field: 'release_status',
      headerName: 'Status de Liberação',
      width: 220,
      renderCell: (params: any) => {
        const value = String(params.row.release_status || 'QUARANTINE').toUpperCase();
        const color = value === 'AVAILABLE' ? '#16a34a' : value === 'BLOCKED' ? '#dc2626' : '#d97706';
        return (
          <span style={{
            padding: '0.2rem 0.6rem',
            borderRadius: 999,
            backgroundColor: `${color}22`,
            color,
            fontWeight: 700,
            fontSize: '0.75rem'
          }}>
            {value}
          </span>
        );
      }
    },
    {
      field: 'orphaCode',
      headerName: 'ORPHA',
      width: 140,
      valueGetter: (params: any) => params.row?.clinical_data?.orphaCode || '-'
    },
  ];

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <Tab value="print">🖨️ Fila de Impressão</Tab>
      <Tab value="quarantine">🟡 Quarentena</Tab>
      <Tab value="available">🟢 Disponível</Tab>
      <Tab value="map">📍 Mapa de Freezers</Tab>

      {tab === 'print' && <PrintQueueDashboard samples={printSamples} onPrint={() => {}} />}

      {(tab === 'quarantine' || tab === 'available') && (
        <Box sx={{ display: 'grid', gap: 2, mb: 2 }}>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <TextField
              size="small"
              label="Filtrar por ORPHA"
              value={orphaFilter}
              onChange={(event) => setOrphaFilter(event.target.value)}
            />
            <TextField
              size="small"
              select
              label="Filtrar por grade RCS"
              value={qualityCategoryFilter}
              onChange={(event) => setQualityCategoryFilter(event.target.value)}
              sx={{ minWidth: 220 }}
            >
              <MenuItem value="">Todas</MenuItem>
              <MenuItem value="A">A</MenuItem>
              <MenuItem value="B">B</MenuItem>
              <MenuItem value="C">C</MenuItem>
              <MenuItem value="D">D</MenuItem>
              <MenuItem value="E">E</MenuItem>
            </TextField>
          </Box>

          {loading ? <div>Carregando inventário...</div> : null}
          {error ? <div style={{ color: '#dc2626' }}>{error}</div> : null}

          <DataGrid rows={filteredRows} columns={columns} autoHeight getRowId={(row) => row.id || row._id || row.sampleID} />
        </Box>
      )}

      {tab === 'map' && (
        <FreezerMapView
          isOpen={true}
          sample={null}
          t={(k: string) => k}
          onClose={() => {}}
          onCompleted={() => {}}
        />
      )}

    </Tabs>
  );
};

export default SampleInventory;
