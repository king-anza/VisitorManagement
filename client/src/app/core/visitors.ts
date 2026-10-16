import { inject, Injectable } from '@angular/core';
import { Api } from './api';
import { Employee, Page, Visitor, VisitorFilters, VisitorQuery, VisitorStats } from './models';

@Injectable({ providedIn: 'root' })
export class Visitors {
  private readonly api = inject(Api);
  list(query: VisitorQuery): Promise<Page<Visitor>> { return this.api.get(`/api/visitors?${this.params(query)}`); }
  stats(from: string, to: string): Promise<VisitorStats> { return this.api.get(`/api/stats?${this.params({ from, to })}`); }
  filters(): Promise<VisitorFilters> { return this.api.get('/api/visitor-filters'); }
  employees(): Promise<Employee[]> { return this.api.get('/api/employees'); }
  detail(id: string): Promise<Visitor> { return this.api.get(`/api/visitors/${encodeURIComponent(id)}`); }
  checkIn(value: Record<string, unknown>): Promise<Visitor> { return this.api.post('/api/visitors', value); }
  correct(id: string, value: Record<string, unknown>): Promise<Visitor> { return this.api.put(`/api/visitors/${encodeURIComponent(id)}`, value); }
  checkout(visitor: Pick<Visitor, 'id'|'version'>): Promise<Visitor> { return this.api.post(`/api/visitors/${encodeURIComponent(visitor.id)}/checkout`, { version: visitor.version }); }
  exportUrl(query: VisitorQuery): string { return `/api/visitors/export?${this.params(query)}`; }
  export(query:VisitorQuery):Promise<Blob>{return this.api.blob(this.exportUrl(query));}
  private params(input: object): URLSearchParams {
    const result = new URLSearchParams();
    for (const [key, value] of Object.entries(input)) if (value !== undefined && value !== null && value !== '') result.set(key, String(value));
    return result;
  }
}
