export class DialogflowAdapter {
  static toUnifiedRequest(dfResponse, sessionId) {
    const query = dfResponse.queryResult;
    return {
      sessionId: sessionId,
      intent: query.intent.displayName,
      parameters: this.parseParams(query.parameters),
      allRequiredParamsPresent: query.allRequiredParamsPresent,
      fulfillmentMessages: query.fulfillmentMessages,
    };
  }

  static parseParams(params) {
    const result = {};
    for (const [k, v] of Object.entries(params.fields || {})) {
      result[k] =
        v.stringValue || v.listValue?.values?.map((v) => v.stringValue) || null;
    }
    return result;
  }
}
