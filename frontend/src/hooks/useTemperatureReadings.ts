import { useCallback, useEffect, useState } from 'react';
import { temperatureService } from '../services/api';
import { useRequestSequence } from './useRequestSequence';

// #1397 (RF009 AC7): the readings persisted in InfluxDB, as GET /temperature
// returns them (InfluxTelemetryReadRepository's mapReportRow), newest first.
export type TemperatureReading = {
  telemetryReadingId: string | null;
  timestamp: string;
  sensorId: string | null;
  temperatureValue: number;
  temperatureUnit: string;
  temperatureCelsius: number;
};

interface ApiLikeError {
  message?: string;
  response?: { data?: { error?: string } };
}

export function useTemperatureReadings(): {
  readings: TemperatureReading[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
} {
  const [readings, setReadings] = useState<TemperatureReading[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRequestSequence();

  const reload = useCallback(async () => {
    const seq = requestSeq.next();
    try {
      setLoading(true);
      const response = await temperatureService.getAll();
      if (!requestSeq.isCurrent(seq)) return;
      const rows: unknown = response.data?.data?.temperatures;
      if (!Array.isArray(rows)) {
        setError('Resposta inválida do servidor');
        setReadings([]);
        return;
      }
      // A row without a finite Celsius value is never drawn, so no NaN and
      // no absent reading rendered as a number (RF009 AC7).
      setReadings((rows as TemperatureReading[]).filter((row) => Number.isFinite(row?.temperatureCelsius)));
      setError(null);
    } catch (err: unknown) {
      if (!requestSeq.isCurrent(seq)) return;
      const typedError = err as ApiLikeError | null;
      setError(typedError?.response?.data?.error ?? typedError?.message ?? 'Erro ao carregar leituras de temperatura');
      setReadings([]);
    } finally {
      if (requestSeq.isCurrent(seq)) setLoading(false);
    }
  }, [requestSeq]);

  useEffect(() => {
    void reload();
    const interval = setInterval(() => { void reload(); }, 15_000);
    return () => clearInterval(interval);
  }, [reload]);

  return { readings, loading, error, reload };
}
