import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export interface AccountPlan {
  id:         number;
  codigo:     string;
  nombre:     string;
  tipo:       'ACTIVO' | 'PASIVO' | 'CAPITAL' | 'INGRESO' | 'GASTO';
  naturaleza: 'DEUDORA' | 'ACREEDORA';
  ctaMayor:   string | null;   // código de la cuenta de mayor padre (estructura SAT)
  nivel:      number;
  parentId:   number | null;
  isActive:   boolean;
  createdAt?: string;
}

export interface AccountNode extends AccountPlan {
  children:  AccountNode[];
  expanded:  boolean;
  indentPx:  number;
}

export interface ImportResult {
  message?:     string;
  importados:   number;
  actualizados: number;
  omitidos:     number;
  total:        number;
  errores:      string[];
}

export interface AccountFilter {
  tipo?:            string;
  naturaleza?:      string;
  search?:          string;
  includeInactive?: boolean;
}

@Injectable({ providedIn: 'root' })
export class AccountPlanService {
  constructor(private api: ApiService) {}

  list(filters: AccountFilter = {}): Observable<AccountPlan[]> {
    return this.api.get<AccountPlan[]>('/account-plan', filters as Record<string, unknown>);
  }

  tree(): Observable<AccountPlan[]> {
    return this.api.get<AccountPlan[]>('/account-plan/tree');
  }

  search(q: string, tipo?: string): Observable<AccountPlan[]> {
    const params: Record<string, unknown> = { q };
    if (tipo) params['tipo'] = tipo;
    return this.api.get<AccountPlan[]>('/account-plan/search', params);
  }

  getById(id: number): Observable<AccountPlan> {
    return this.api.get<AccountPlan>(`/account-plan/${id}`);
  }

  create(payload: Partial<AccountPlan>): Observable<AccountPlan> {
    return this.api.post<AccountPlan>('/account-plan', payload);
  }

  update(id: number, payload: Partial<AccountPlan>): Observable<AccountPlan> {
    return this.api.patch<AccountPlan>(`/account-plan/${id}`, payload);
  }

  deactivate(id: number): Observable<{ message: string; id: number }> {
    return this.api.delete(`/account-plan/${id}`);
  }

  import(file: File): Observable<ImportResult> {
    return this.api.uploadFiles<ImportResult>('/account-plan/import', [file], 'excelFile');
  }

  // ── Construye árbol jerárquico desde lista plana ──────────────────────────
  buildTree(accounts: AccountPlan[]): AccountNode[] {
    const map = new Map<number, AccountNode>();

    accounts.forEach(acc => {
      map.set(acc.id, { ...acc, children: [], expanded: false, indentPx: 0 });
    });

    const roots: AccountNode[] = [];

    accounts.forEach(acc => {
      const node = map.get(acc.id)!;
      if (acc.parentId != null && map.has(acc.parentId)) {
        map.get(acc.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    });

    map.forEach(node => {
      node.children.sort((a, b) => a.codigo.localeCompare(b.codigo));
    });
    roots.sort((a, b) => a.codigo.localeCompare(b.codigo));

    const setDepth = (nodes: AccountNode[], depth: number): void => {
      for (const node of nodes) {
        node.nivel    = depth;
        node.indentPx = (depth - 1) * 20;
        node.expanded = depth <= 2;
        setDepth(node.children, depth + 1);
      }
    };
    setDepth(roots, 1);

    return roots;
  }

  flattenTree(nodes: AccountNode[], result: AccountNode[] = []): AccountNode[] {
    for (const node of nodes) {
      result.push(node);
      if (node.expanded && node.children.length > 0) {
        this.flattenTree(node.children, result);
      }
    }
    return result;
  }
}
