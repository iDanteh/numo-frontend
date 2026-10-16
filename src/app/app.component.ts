import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { filter, takeUntil } from 'rxjs/operators';
import { AuthService } from './core/services/auth.service';

@Component({
  standalone:  false,
  selector:    'app-root',
  templateUrl: './app.component.html',
})
export class AppComponent implements OnInit, OnDestroy {
  // sistema-lealtad (PR5): el shell de Lealtad trae su propio sidebar
  // (amber) — el global de Numo debe ocultarse bajo /lealtad/** (spec
  // "Route-Aware Sidebar Suppression"). isPublicLealtad cubre la página
  // pública /lealtad/consulta, que no debe mostrar NINGÚN layout de staff
  // (ni sidebar ni el loader de auth.isLoading) aunque la sesión esté
  // autenticada (spec "Unguarded Public Consulta Route").
  showGlobalSidebar = true;
  isPublicLealtad   = false;

  private readonly destroy$ = new Subject<void>();

  constructor(public auth: AuthService, private readonly router: Router) {}

  ngOnInit(): void {
    // Evalúa la URL inicial de una vez — con hash routing (useHash:true) el
    // primer NavigationEnd puede tardar un tick, y sin esto /lealtad/consulta
    // alcanzaría a pintar el layout de staff por un frame antes de ocultarlo.
    this.updateLayout(this.router.url);

    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntil(this.destroy$),
      )
      .subscribe(e => this.updateLayout(e.urlAfterRedirects));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private updateLayout(url: string): void {
    const path = url.split(/[?#]/)[0];
    this.isPublicLealtad   = path === '/lealtad/consulta' || path.startsWith('/lealtad/consulta/');
    this.showGlobalSidebar = !(path === '/lealtad' || path.startsWith('/lealtad/'));
  }

  // Red de seguridad global (2026-09-14, bug real reportado por el usuario): sin esto,
  // soltar un archivo en cualquier punto de la app que no tenga su propio manejador de
  // drop (ej. apenas afuera de una zona de drag&drop chica, como .erp-ficha-dropzone en
  // erp-modal) deja que el navegador tome el control por default y NAVEGUE la pestaña
  // entera para mostrar el archivo — reemplaza la SPA por completo, lo que se siente como
  // que "la vista se congela y no se puede cerrar nada". No afecta ningún drop real que ya
  // se maneje puntualmente (ese preventDefault corre primero y el evento sigue burbujeando
  // igual hasta acá, pero el navegador ya no ejecuta su acción por default).
  @HostListener('window:dragover', ['$event'])
  onWindowDragOver(event: DragEvent): void { event.preventDefault(); }

  @HostListener('window:drop', ['$event'])
  onWindowDrop(event: DragEvent): void { event.preventDefault(); }
}
