import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  standalone: false,
  selector: 'app-cer-key-upload',
  templateUrl: './cer-key-upload.component.html',
})
export class CerKeyUploadComponent {
  @Input() cerFile: File | null = null;
  @Input() keyFile: File | null = null;
  @Output() cerFileChange = new EventEmitter<File | null>();
  @Output() keyFileChange = new EventEmitter<File | null>();

  cerDragOver = false;
  keyDragOver = false;

  onCerDrop(event: DragEvent): void {
    event.preventDefault();
    this.cerDragOver = false;
    const file = event.dataTransfer?.files?.[0];
    if (file) this.cerFileChange.emit(file);
  }

  onKeyDrop(event: DragEvent): void {
    event.preventDefault();
    this.keyDragOver = false;
    const file = event.dataTransfer?.files?.[0];
    if (file) this.keyFileChange.emit(file);
  }

  onCerSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.[0]) this.cerFileChange.emit(input.files[0]);
  }

  onKeySelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.[0]) this.keyFileChange.emit(input.files[0]);
  }
}
