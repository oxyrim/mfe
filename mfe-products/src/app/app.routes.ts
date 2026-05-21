import { Routes } from '@angular/router';
import { ProductsComponent } from './products.component';

export const routes: Routes = [
  { path: '',   component: ProductsComponent },
  { path: '**', redirectTo: '' },
];
