// Utils cho việc build Request Header và tương tác chung với WordPress API

export const buildWpHeaders = (wpUser: string, wpAppPass: string) => {
  const credentials = Buffer.from(`${wpUser}:${wpAppPass}`).toString('base64');
  return {
    'Authorization': `Basic ${credentials}`,
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 SaaS-AutoPost-v1'
  };
};
