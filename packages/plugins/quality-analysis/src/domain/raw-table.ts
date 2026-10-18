export interface QualityRawTable {
  readonly complete:true;
  readonly byteLength:number;
  readonly headers:readonly string[];
  readonly rows:readonly (readonly (string|number|boolean|null)[])[];
  readonly locations:readonly {readonly record:number;readonly line:number}[];
}
