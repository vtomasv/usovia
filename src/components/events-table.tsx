import { ArrowUpRight } from 'lucide-react';
import type { UsageEvent, Account } from '../types';
import { formatShortDate as date, channelLabels as channels } from '../format';
export function EventsTable({
  events,
  accountFor,
  onSelect,
}: {
  events: UsageEvent[];
  accountFor: (id: string) => Account | undefined;
  onSelect: (e: UsageEvent) => void;
}) {
  return (
    <table>
      <thead>
        <tr>
          <th>Tarea y consulta</th>
          <th>Cuenta</th>
          <th>Canal</th>
          <th>Recibido</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {events.map((e) => (
          <tr key={e.id} className="clickable" onClick={() => onSelect(e)}>
            <td>
              <strong>{e.label}</strong>
              <small className="truncate">{e.redactedText}</small>
            </td>
            <td>
              {accountFor(e.accountId)?.label || 'Cuenta'}
              <small>{accountFor(e.accountId)?.department}</small>
            </td>
            <td>
              <span className="status neutral">{channels[e.channel] || 'Aporte revisado'}</span>
              <small>{e.provider}</small>
            </td>
            <td>{date(e.receivedAt)}</td>
            <td>
              <ArrowUpRight size={17} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
