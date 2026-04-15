import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

@Component({
  standalone: false,
  selector: 'app-sat',
  templateUrl: './sat.component.html',
})
export class SatComponent implements OnInit {
  tabParams: Record<string, number> = {};

  constructor(private route: ActivatedRoute) {}

  ngOnInit(): void {
    const qp = this.route.snapshot.queryParamMap;
    const ej = qp.get('ejercicio');
    const pe = qp.get('periodo');
    if (ej) this.tabParams['ejercicio'] = parseInt(ej);
    if (pe) this.tabParams['periodo']   = parseInt(pe);
  }
}
