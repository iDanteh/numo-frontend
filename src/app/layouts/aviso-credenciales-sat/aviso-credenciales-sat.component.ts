import { Component, OnInit } from '@angular/core';
import { Observable } from 'rxjs';
import { AvisoCredencialesSat, AvisoCredencialesService } from '../../core/services/aviso-credenciales.service';
import { AuthService } from '../../core/services/auth.service';

/**
 * Banner fijo arriba de todas las vistas cuando las credenciales SAT están
 * por vencer (desde las 12:00 del día anterior) o ya faltan. No se puede
 * cerrar: desaparece solo cuando se vuelven a subir.
 */
@Component({
  standalone:  false,
  selector:    'app-aviso-credenciales-sat',
  templateUrl: './aviso-credenciales-sat.component.html',
  styleUrls:   ['./aviso-credenciales-sat.component.css'],
})
export class AvisoCredencialesSatComponent implements OnInit {
  readonly avisos$: Observable<AvisoCredencialesSat[]>;

  constructor(private avisoSvc: AvisoCredencialesService, private auth: AuthService) {
    this.avisos$ = this.avisoSvc.avisos$;
  }

  /** Getter (no campo): los permisos pueden llegar después de crear el componente. */
  get puedeSubir(): boolean {
    return this.auth.hasPermission('visor:sat');
  }

  ngOnInit(): void {
    this.avisoSvc.iniciar();
  }

  fechaVence(aviso: AvisoCredencialesSat): string {
    if (!aviso.expiraEn) return '';
    return new Date(aviso.expiraEn).toLocaleString('es-MX', {
      timeZone: 'America/Mexico_City', weekday: 'long', day: 'numeric', month: 'long',
      hour: 'numeric', minute: '2-digit',
    });
  }

  empresa(aviso: AvisoCredencialesSat): string {
    return aviso.nombre ? `${aviso.nombre} (${aviso.rfc})` : aviso.rfc;
  }
}
