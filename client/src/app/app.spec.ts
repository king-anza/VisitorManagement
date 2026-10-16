import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  it('creates the Angular application root', async () => {
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
    expect(TestBed.createComponent(App).componentInstance).toBeTruthy();
  });
});
