import { EventEmitter } from "events";

type FaultEventCreatedPayload = {
  eventId: number;
  machineCode: string;
  faultCode: string;
  severity: "low" | "warning" | "high" | "critical";
  occurredAt: string;
  alertsTriggered: number;
  correlationId?: string;
};

type InvestigationCaseUpdatedPayload = {
  caseId: number;
  status: string;
  caseCode: string;
  machineCode: string;
  faultCode: string;
  title: string;
  ownerName?: string | null;
  occurredAt: string;
};

class RealtimeHub extends EventEmitter {
  publishFaultEventCreated(payload: FaultEventCreatedPayload) {
    this.emit("fault_event_created", payload);
  }

  publishInvestigationCaseUpdated(payload: InvestigationCaseUpdatedPayload) {
    this.emit("investigation_case_updated", payload);
  }
}

export const realtimeHub = new RealtimeHub();
