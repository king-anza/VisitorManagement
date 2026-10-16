import { PublicI18n } from './public-i18n';

describe('visitor language service',()=>{
  beforeEach(()=>localStorage.removeItem('visitor-language'));

  it('translates text, interpolates values and updates the page language',()=>{
    const i18n=new PublicI18n();
    i18n.setLanguage('af');
    expect(i18n.t('howHelp')).toBe('Hoe kan ons help?');
    expect(i18n.t('clearWarning',{seconds:12})).toContain('12');
    expect(localStorage.getItem('visitor-language')).toBe('af');
    expect(document.documentElement.lang).toBe('af');
  });

  it('supports isiZulu and safely falls back to English',()=>{
    const i18n=new PublicI18n();
    i18n.setLanguage('zu');
    expect(i18n.t('join')).toContain('Ngena kulayini');
    i18n.setLanguage('unsupported');
    expect(i18n.language()).toBe('en');
    expect(i18n.t('finish')).toBe('Finish');
  });
});
