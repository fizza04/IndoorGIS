import { auditAPI } from './api';
import { InspectionData } from '../components/InspectionForm';

/**
 * Audit service for handling audit session operations
 */
export class AuditService {
  /**
   * Start an audit session
   */
  static async startAuditSession(routeId: string) {
    try {
      const response = await auditAPI.startAuditSession(routeId);
      const sessionData = await auditAPI.getAuditSession(response.sessionId);
      
      const formattedSession = {
        session_id: sessionData.session_id,
        route_id: sessionData.route_id,
        auditor_id: sessionData.auditor_id,
        status: sessionData.status,
        session_status: sessionData.status,
        started_at: sessionData.started_at,
        completed_pois: sessionData.completed_pois || [],
        total_pois: sessionData.total_pois || 0,
        last_updated: sessionData.last_updated,
      };
      
      return { sessionId: response.sessionId, sessionData: formattedSession };
    } catch (error: any) {
      console.error('❌ Error starting audit session:', error);
      throw new Error(`Failed to start audit session: ${error.message}`);
    }
  }

  /**
   * End an audit session
   */
  static async endAuditSession(sessionId: string) {
    try {
      await auditAPI.endAuditSession(sessionId);
    } catch (error: any) {
      console.error('❌ Error ending audit session:', error);
      throw new Error(`Failed to end audit session: ${error.message}`);
    }
  }

  /**
   * Submit POI inspection with walking time data
   */
  static async submitPOIInspection(
    sessionId: string,
    inspectionData: InspectionData,
    walkingTimeSeconds: number,
    formatWalkingTime: (seconds: number) => string
  ) {
    try {
      const inspectionDataWithWalkingTime = {
        ...inspectionData,
        walkingTimeSeconds,
        walkingTimeFormatted: formatWalkingTime(walkingTimeSeconds),
        completedAt: new Date().toISOString()
      };
      
      const response = await auditAPI.submitPOIAudit(
        sessionId,
        inspectionData.poiId,
        inspectionDataWithWalkingTime,
      );

      if (response.status === 'success') {
        return true;
      } else {
        throw new Error('Failed to submit POI inspection data');
      }
    } catch (error: any) {
      console.error('❌ Error submitting POI inspection:', error);
      throw new Error(`Failed to submit inspection data: ${error.message}`);
    }
  }

  /**
   * Fetch next POI to scan
   */
  static async fetchNextPOI(sessionId: string) {
    try {
      const response = await auditAPI.getNextPOI(sessionId);
      return response;
    } catch (error: any) {
      console.error('❌ Error fetching next POI:', error);
      throw new Error(`Failed to fetch next POI: ${error.message}`);
    }
  }

  /**
   * Get audit session data
   */
  static async getAuditSession(sessionId: string) {
    try {
      const sessionData = await auditAPI.getAuditSession(sessionId);
      return sessionData;
    } catch (error: any) {
      console.error('❌ Error fetching audit session:', error);
      throw new Error(`Failed to fetch audit session: ${error.message}`);
    }
  }

  /**
   * Check if session should be auto-ended
   */
  static shouldAutoEndSession(sessionProgress: any): boolean {
    return sessionProgress && sessionProgress.completed >= sessionProgress.total;
  }

  /**
   * Validate session state before operations
   */
  static validateSessionState(auditSession: any, operation: string): boolean {
    if (!auditSession?.session_id) {
      console.error(`❌ No active audit session found for ${operation}`);
      return false;
    }
    return true;
  }
}
