export interface WorkbenchStateRec {
  state_id: string;
  label: string;
  fingerprint: string;
  revision?: number;
  input_source?: string | null;
  output?: string | null;
  loop_element?: string | null;
  feedback_sign?: number;
  ranges?: Record<string, number>;
  params?: Record<string, unknown>;
  circuit?: CircuitPayload;
  created_at?: number;
  updated_at?: number;
}

export interface CircuitPayload {
  nodes?: Array<Record<string, unknown>>;
  edges?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface WorkbenchSessionRec {
  session_id: string;
  name: string;
  states: WorkbenchStateRec[];
  selected_state_id?: string | null;
  active_state_id?: string | null;
  results?: Array<Record<string, unknown>>;
}

export interface SessionResponse { ok?: boolean; session?: WorkbenchSessionRec }
export interface StateResponse { ok?: boolean; state?: WorkbenchStateRec; session?: WorkbenchSessionRec }
export interface RunResponse { ok?: boolean; kind?: string; state_id?: string; envelope?: import('./analysis_chart_types.js').AnalysisEnvelope; raw?: Record<string, unknown>; cache?: Record<string, unknown>; fingerprint?: string }
export interface CompareResponse { ok?: boolean; states?: Array<{state_id: string; label: string; envelope?: import('./analysis_chart_types.js').AnalysisEnvelope; cache?: Record<string, unknown>}>; metrics?: Record<string, Array<{state_id: string; label: string; value: unknown}>> }
