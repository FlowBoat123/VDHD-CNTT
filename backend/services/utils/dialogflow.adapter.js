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


  static valueToJs(v) {
    if (!v) return null;
    if (typeof v.stringValue === "string") return v.stringValue;
    if (typeof v.numberValue === "number") return v.numberValue;
    if (typeof v.boolValue === "boolean") return v.boolValue;
    if (v.nullValue !== undefined && v.nullValue !== null) return null;
    if (v.structValue && v.structValue.fields) {
      const obj = {};
      for (const [kk, vv] of Object.entries(v.structValue.fields)) {
        obj[kk] = this.valueToJs(vv);
      }
      return obj;
    }
    if (v.listValue && Array.isArray(v.listValue.values)) {
      return v.listValue.values.map((vv) => this.valueToJs(vv));
    }
    return null;
  }

  static parseParams(params) {
    const result = {};
    for (const [k, v] of Object.entries(params.fields || {})) {
      result[k] = this.valueToJs(v);
    }
    return result;
  }
}
