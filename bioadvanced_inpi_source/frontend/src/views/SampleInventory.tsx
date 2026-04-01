import React, { useState } from 'react';
import PrintQueueDashboard from '../components/PrintQueueDashboard';
import CryoLabelPrinter from '../components/CryoLabelPrinter';
import { SampleLabelData } from '../types/labels';
import { Tabs, Tab } from '@radix-ui/react-tabs';
import { DataGrid } from '@mui/x-data-grid';
import { Box, Button, Menu, MenuItem, Modal } from '@mui/material';
import { useSamplesInventory } from '../hooks/samples/useSamplesInventory';
import FreezerMapView from '../components/samples/StorageHierarchy';

export const SampleInventory: React.FC = () => {
  const { printQueue, quarantined, available, allSamples, moveSample, aliquotSample, withdrawSample, checkinSample } = useSamplesInventory();
  const [tab, setTab] = useState('print');
  const [actionModal, setActionModal] = useState<{ type: string; sample: SampleLabelData | null }>({ type: '', sample: null });

  const handleAction = (type: string, sample: SampleLabelData) => {
    setActionModal({ type, sample });
  };

  const closeModal = () => setActionModal({ type: '', sample: null });

  const renderActionsMenu = (sample: SampleLabelData) => (
    <Menu>
      <MenuItem onClick={() => handleAction('move', sample)}>Movimentar</MenuItem>
      <MenuItem onClick={() => handleAction('aliquot', sample)}>Retirada Parcial</MenuItem>
      <MenuItem onClick={() => handleAction('withdraw', sample)}>Retirada Integral</MenuItem>
      <MenuItem onClick={() => handleAction('checkin', sample)}>Devolução</MenuItem>
    </Menu>
  );

  const columns = [
    { field: 'sampleId', headerName: 'ID', width: 120 },
    { field: 'status', headerName: 'Status', width: 110 },
    { field: 'location', headerName: 'Localização Atual', width: 200, valueGetter: (params: any) => `${params.row.equipmentLabel || params.row.equipmentId} / ${params.row.boxLabel || params.row.boxId} / ${params.row.coordinate}` },
    { field: 'actions', headerName: 'Ações', width: 160, renderCell: (params: any) => renderActionsMenu(params.row) },
  ];

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <Tab value="print">🖨️ Fila de Impressão</Tab>
      <Tab value="quarantine">🟡 Quarentena</Tab>
      <Tab value="available">🟢 Disponível</Tab>
      <Tab value="map">📍 Mapa de Freezers</Tab>

      {tab === 'print' && <PrintQueueDashboard samples={printQueue} onPrint={() => {}} />}
      {tab === 'quarantine' && <DataGrid rows={quarantined} columns={columns} autoHeight />}
      {tab === 'available' && <DataGrid rows={available} columns={columns} autoHeight />}
      {tab === 'map' && (
        <FreezerMapView
          isOpen={true}
          sample={null}
          t={(k: string) => k}
          onClose={() => {}}
          onCompleted={() => {}}
        />
      )}

      <Modal open={!!actionModal.type} onClose={closeModal}>
        <Box>
          {/* Render modais específicos para cada ação aqui */}
          {actionModal.type === 'move' && <div>Modal de Movimentação</div>}
          {actionModal.type === 'aliquot' && <div>Modal de Retirada Parcial</div>}
          {actionModal.type === 'withdraw' && <div>Modal de Retirada Integral</div>}
          {actionModal.type === 'checkin' && <div>Modal de Devolução</div>}
        </Box>
      </Modal>
    </Tabs>
  );
};

export default SampleInventory;
