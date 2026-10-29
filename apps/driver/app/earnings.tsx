import { EarningsSummary, errorMessage, formatInr } from '@saheli/api-client';
import {
  Banner,
  Button,
  Card,
  Loading,
  Muted,
  Row,
  Screen,
  type,
  useAuth,
} from '@saheli/mobile-core';
import { useCallback, useEffect, useState } from 'react';
import { Text } from 'react-native';

const istDate = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const daysAgo = (n: number) => istDate(new Date(Date.now() - n * 86_400_000));
const PERIODS = { Today: 0, Week: 6, Month: 29 } as const;

export default function Earnings() {
  const { api } = useAuth();
  const [period, setPeriod] = useState<keyof typeof PERIODS>('Week');
  const [data, setData] = useState<EarningsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.earnings(daysAgo(PERIODS[period]), daysAgo(0)));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [api, period]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data)
    return error ? (
      <Screen>
        <Banner tone="error">{error}</Banner>
      </Screen>
    ) : (
      <Loading />
    );
  const owed = data.balance.netPaise;
  return (
    <Screen>
      <Row>
        {(Object.keys(PERIODS) as (keyof typeof PERIODS)[]).map((p) => (
          <Button
            key={p}
            title={p}
            variant={p === period ? 'primary' : 'secondary'}
            onPress={() => setPeriod(p)}
            style={{ flex: 1 }}
          />
        ))}
      </Row>
      <Card>
        <Muted>Your earnings</Muted>
        <Text style={type.title}>{formatInr(data.earningsPaise)}</Text>
        <Muted>
          {data.trips} trips · fares {formatInr(data.grossFarePaise)} · commission{' '}
          {formatInr(data.commissionPaise)}
        </Muted>
        <Muted>Cash collected {formatInr(data.cashCollectedPaise)}</Muted>
      </Card>
      <Card>
        <Text style={type.heading}>
          {owed >= 0 ? `Saheli owes you ${formatInr(owed)}` : `You owe Saheli ${formatInr(-owed)}`}
        </Text>
        <Muted>Earnings minus cash you have collected, before the next payout.</Muted>
      </Card>
      <Card>
        <Text style={type.heading}>Payouts</Text>
        {data.payouts.length === 0 ? <Muted>No payouts yet.</Muted> : null}
        {data.payouts.map((p) => (
          <Row key={p.id} style={{ justifyContent: 'space-between', marginTop: 6 }}>
            <Muted>{p.periodEnd}</Muted>
            <Muted>
              {formatInr(p.amountPaise)} · {p.status.toLowerCase()}
            </Muted>
          </Row>
        ))}
      </Card>
    </Screen>
  );
}
