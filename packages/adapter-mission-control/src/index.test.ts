import { describe, expect, it } from 'bun:test';

import {
  mapBundleRecordToMissionControlStatus,
  mapMissionControlReceiptToReceiptSubmitInput,
  mapMissionControlTaskToBundlePlanInput,
  mapReceiptRecordToMissionControlStatus,
} from './index';

describe('adapter-mission-control package surface', () => {
  it('maps mission control tasks to the SCBS planning contract', () => {
    expect(
      mapMissionControlTaskToBundlePlanInput({
        missionId: 'mission_7',
        objective: 'Report freshness drift',
        repoIds: ['repo_1', 'repo_2'],
        bundleParentId: 'bundle_parent',
        fileTargets: ['src/index.ts'],
        symbolTargets: ['getFreshnessStatus'],
      })
    ).toEqual({
      task: 'Report freshness drift',
      repoIds: ['repo_1', 'repo_2'],
      parentBundleId: 'bundle_parent',
      fileScope: ['src/index.ts'],
      symbolScope: ['getFreshnessStatus'],
    });
  });

  it('maps SCBS bundle and receipt records to explicit mission control statuses', () => {
    expect(
      mapBundleRecordToMissionControlStatus(
        {
          id: 'bundle_7',
          repoIds: ['repo_1'],
          task: 'Report freshness drift',
          viewIds: ['view_1', 'view_2'],
          freshness: 'partial',
          parentBundleId: 'bundle_parent',
        },
        'mission_7'
      )
    ).toEqual({
      missionId: 'mission_7',
      bundleId: 'bundle_7',
      task: 'Report freshness drift',
      repoIds: ['repo_1'],
      trackedViewIds: ['view_1', 'view_2'],
      freshness: 'partial',
      bundleParentId: 'bundle_parent',
    });

    expect(
      mapMissionControlReceiptToReceiptSubmitInput({
        missionId: 'mission_7',
        reporter: 'ops-bot',
        notes: 'Bundle verified',
        bundleRef: 'bundle_7',
      })
    ).toEqual({
      bundleId: 'bundle_7',
      agent: 'ops-bot',
      summary: 'Bundle verified',
    });

    expect(
      mapReceiptRecordToMissionControlStatus(
        {
          id: 'receipt_7',
          bundleId: null,
          agent: 'ops-bot',
          summary: 'Bundle verified',
          status: 'rejected',
        },
        'mission_7'
      )
    ).toEqual({
      missionId: 'mission_7',
      receiptId: 'receipt_7',
      reporter: 'ops-bot',
      notes: 'Bundle verified',
      state: 'rejected',
      bundleRef: undefined,
    });
  });
});
