import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './theme.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
})
export class AppComponent {
  // Injecting ThemeService here triggers its constructor, which registers
  // the window message listener before any child component renders.
  private readonly _theme = inject(ThemeService);
}
