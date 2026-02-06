import axios from "axios";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PriceV2 {
  type: "fixed";
  value: number;
}

export interface JobOfferingData {
  name: string;
  description: string;
  priceV2: PriceV2;
  slaMinutes: number;
  requiredFunds: boolean;
  requirement: Record<string, string>;
  deliverable: string;
}

export interface CreateJobOfferingResponse {
  success: boolean;
  /** Raw response body from the ACP API (shape may evolve). */
  data?: unknown;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ACP_BASE_URL = "http://localhost:3001";

// ---------------------------------------------------------------------------
// Implementations
// ---------------------------------------------------------------------------

/**
 * Create a job offering on ACP by calling POST /acp/job-offerings.
 *
 * @param apiKey   - The x-api-key for authenticating with the ACP service.
 * @param offering - The job offering payload.
 */
async function createJobOffering(
  apiKey: string,
  offering: JobOfferingData,
): Promise<CreateJobOfferingResponse> {
  try {
    const { data } = await axios.post(
      `${ACP_BASE_URL}/acp/job-offerings`,
      { data: offering },
      {
        headers: {
          "x-api-key": apiKey,
          "Content-Type": "application/json",
        },
      },
    );
    return { success: true, data };
  } catch (error: unknown) {
    const msg =
      error instanceof Error ? error.message : String(error);
    console.error(`❌ ACP createJobOffering failed: ${msg}`);
    return { success: false };
  }
}

async function deleteJobOffering(
  apiKey: string,
  offeringName: string,
): Promise<{ success: boolean }> {
  try {
    await axios.delete(
      `${ACP_BASE_URL}/acp/job-offerings/${encodeURIComponent(offeringName)}`,
      {
        headers: {
          "x-api-key": apiKey,
          "Content-Type": "application/json",
        },
      },
    );
    return { success: true };
  } catch (error: unknown) {
    const msg =
      error instanceof Error ? error.message : String(error);
    console.error(`❌ ACP deleteJobOffering failed: ${msg}`);
    return { success: false };
  }
}

// ---------------------------------------------------------------------------
// Mock — used while the ACP endpoint is not available.
// ---------------------------------------------------------------------------

async function createJobOfferingMock(
  _apiKey: string,
  _offering: JobOfferingData,
): Promise<CreateJobOfferingResponse> {
  return { success: true, data: { id: "mock-offering-id" } };
}

async function deleteJobOfferingMock(
  _apiKey: string,
  _offeringName: string,
): Promise<{ success: boolean }> {
  return { success: true };
}

// ---------------------------------------------------------------------------
// Exports — swap mock → real here when the ACP endpoint is live.
// ---------------------------------------------------------------------------

export { createJobOfferingMock as createJobOffering };   // swap to createJobOffering
export { deleteJobOfferingMock as deleteJobOffering };   // swap to deleteJobOffering
