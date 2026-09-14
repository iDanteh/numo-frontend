import { Component, HostListener } from '@angular/core';
import { AuthService } from './core/services/auth.service';

@Component({
  standalone:  false,
  selector:    'app-root',
  templateUrl: './app.component.html',
})
export class AppComponent {
  constructor(public auth: AuthService) {}

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
